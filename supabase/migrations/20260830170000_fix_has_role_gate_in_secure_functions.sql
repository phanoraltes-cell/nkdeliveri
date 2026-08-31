-- FIX (siyale pa Altes) — gad admin nan plizyè fonksyon `_secure` nou kreye
-- 2026-08-30 rele `public.has_role(...)` pou verifye wòl admin/super_admin
-- la anvan yo kontinye. `public.has_role` se yon RETLAY SECURITY INVOKER
-- (wè 20260704160000_47e8011e...sql) ki egziste EKSPRÈ pou pwoteje Data
-- API a kont yon kliyan ki ta eseye tcheke wòl yon LÒT itilizatè — men sa
-- vin fè l pa fyab lè li rele SOU LI MENM anndan yon fonksyon
-- SECURITY DEFINER: kontèks/wòl ki aktif la nan moman apèl la pa garanti
-- ekivalan a `auth.uid()` sesyon an, e verifikasyon an ka tonbe sou
-- `false` pou yon vre admin — sa a se egzakteman sa ki lakòz
-- get_admin_ai_traffic_stats_secure voye 'Forbidden' (500 sou
-- /api/admin/ai) pou yon admin ki byen konekte.
--
-- KORIJE: itilize DIREKTEMAN `private.has_role(...)` (SECURITY DEFINER,
-- wè 20260703070152_4f042d50...sql) pou chak gad admin ANNDAN yon
-- fonksyon `_secure` — menm modèl ak `audit_log`'s RLS policy ("admin
-- read" ki deja rele private.has_role dirèkteman, jamè public.has_role).
--
-- ODIT KONPLE — chak plas 2026-08-30 yo (Tach 1 siyalman + Tach 2 AI) te
-- itilize `public.has_role` ANNDAN kò yon fonksyon SECURITY DEFINER kòm
-- yon gad ("IF NOT (public.has_role(...) OR public.has_role(...))") oswa
-- kòm yon detèminasyon wòl entèn ("v_is_admin := ..."):
--   1. add_report_message_secure    — v_is_admin := ...   (KORIJE anba a)
--   2. set_report_status_secure     — gad admin            (KORIJE)
--   3. reject_report_secure         — gad admin            (KORIJE)
--   4. resolve_report_secure        — gad admin            (KORIJE)
--   5. request_target_explanation_secure — gad admin       (KORIJE)
--   6. get_reports_admin            — gad admin            (KORIJE)
--   7. get_admin_ai_traffic_stats_secure — gad admin       (KORIJE)
--   8. get_admin_priorities_secure  — gad admin            (KORIJE)
-- `create_report_secure`/`submit_target_explanation_secure`/
-- `get_shared_reports_for_target_secure` PA gen gad admin ditou (yo
-- verifye kliyan/sib, pa wòl admin) — pa konsène.
--
-- POLICY RLS (`CREATE POLICY ... USING (public.has_role(...))`, nan
-- reports/report_messages/report-evidence/ai_usage_log/ai_summary_cache)
-- yo PA touche isit la: yon "USING" klause RLS evalye dirèkteman anba
-- wòl PostgREST ki fè demand lan (`authenticated`), pa anndan yon
-- kontèks SECURITY DEFINER anbrike — se yon mekanis diferan, e li matche
-- MENM konvansyon ak plizyè lòt RLS policy ki deja egziste e ki mache
-- (disputes.sql, refunds.sql, elatriye).
--
-- Menm siyati egzat pou chak fonksyon — CREATE OR REPLACE san danje,
-- pa gen okenn DROP FUNCTION nesesè (wè scripts/check-migration-hazards.mjs).

-- ---------------------------------------------------------------------------
-- 1) add_report_message_secure(uuid, text)
CREATE OR REPLACE FUNCTION public.add_report_message_secure(_report_id uuid, _message text)
RETURNS public.report_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_report public.reports;
  v_role public.report_message_author;
  v_row public.report_messages;
  v_is_admin boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _message IS NULL OR length(btrim(_message)) = 0 THEN
    RAISE EXCEPTION 'Message pa ka vid';
  END IF;

  IF NOT public.check_rate_limit_secure('add_report_message', 20, 600) THEN
    RAISE EXCEPTION 'Twòp mesaj. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');
  IF v_report.reporter_id = v_user THEN
    v_role := 'customer';
  ELSIF v_is_admin THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.report_messages (report_id, author_id, author_role, message)
  VALUES (_report_id, v_user, v_role, btrim(_message))
  RETURNING * INTO v_row;

  UPDATE public.reports SET updated_at = now() WHERE id = _report_id;

  IF v_role = 'customer' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT ur.user_id, 'report_message', 'Nouvo mesaj nan yon siyalman',
      'Kliyan an reponn nan dosye #' || left(v_report.id::text, 8) || '.',
      jsonb_build_object('report_id', v_report.id, 'order_id', v_report.order_id)
    FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_report.reporter_id, 'report_message', 'Nouvo repons nan siyalman ou',
      'Yon administratè reponn nan dosye ou a.',
      jsonb_build_object('report_id', v_report.id, 'order_id', v_report.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) set_report_status_secure(uuid, text, text)
CREATE OR REPLACE FUNCTION public.set_report_status_secure(_report_id uuid, _status text, _admin_note text DEFAULT NULL)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.reports;
  v_status public.report_status;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_status := _status::public.report_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Estati envalid';
  END;
  IF v_status NOT IN ('open', 'reviewing') THEN
    RAISE EXCEPTION 'Itilize resolve_report_secure oswa reject_report_secure pou estati final';
  END IF;

  UPDATE public.reports SET
    status = v_status, admin_note = COALESCE(NULLIF(btrim(_admin_note), ''), admin_note), updated_at = now()
  WHERE id = _report_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'report.status_changed',
    jsonb_build_object('report_id', v_row.id, 'status', v_status));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.reporter_id, 'report_status', 'Dosye #' || left(v_row.id::text, 8) || ' mete ajou',
    'Estati: ' || (CASE v_status WHEN 'reviewing' THEN 'Anba etid' ELSE 'Resevwa' END),
    jsonb_build_object('report_id', v_row.id, 'order_id', v_row.order_id)
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) reject_report_secure(uuid, text)
CREATE OR REPLACE FUNCTION public.reject_report_secure(_report_id uuid, _admin_note text)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.reports;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;
  IF v_row.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Dosye sa a deja fèmen';
  END IF;

  UPDATE public.reports SET
    status = 'rejected', admin_note = COALESCE(NULLIF(btrim(_admin_note), ''), admin_note),
    reviewed_by = v_user, reviewed_at = now(), updated_at = now()
  WHERE id = _report_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'report.rejected',
    jsonb_build_object('report_id', v_row.id));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.reporter_id, 'report_status', 'Dosye #' || left(v_row.id::text, 8) || ' mete ajou',
    'Estati: Rejte' || COALESCE(' — ' || v_row.admin_note, ''),
    jsonb_build_object('report_id', v_row.id, 'order_id', v_row.order_id)
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) resolve_report_secure(uuid, text, text)
CREATE OR REPLACE FUNCTION public.resolve_report_secure(_report_id uuid, _resolution text, _admin_note text)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.reports;
  v_resolution public.report_resolution;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_resolution := _resolution::public.report_resolution;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Rezolisyon envalid';
  END;

  SELECT * INTO v_row FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;
  IF v_row.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Dosye sa a deja fèmen';
  END IF;

  IF v_resolution = 'suspension' THEN
    IF v_row.target_type = 'courier' THEN
      PERFORM public.update_driver_status_secure(v_row.target_id, 'suspended', 'Siyalman #' || left(v_row.id::text, 8));
    ELSE
      PERFORM public.update_restaurant_status_secure(v_row.target_id, 'suspended');
    END IF;
  END IF;

  UPDATE public.reports SET
    status = 'resolved', resolution = v_resolution,
    admin_note = COALESCE(NULLIF(btrim(_admin_note), ''), admin_note),
    reviewed_by = v_user, reviewed_at = now(), updated_at = now()
  WHERE id = _report_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'report.resolved',
    jsonb_build_object('report_id', v_row.id, 'resolution', v_resolution));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.reporter_id, 'report_status', 'Dosye #' || left(v_row.id::text, 8) || ' mete ajou',
    'Estati: Rezoud' || COALESCE(' — ' || v_row.admin_note, ''),
    jsonb_build_object('report_id', v_row.id, 'order_id', v_row.order_id)
  );

  IF v_resolution = 'warning' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT dr.user_id, 'report_warning', 'Yon avètisman sou sèvis ou',
      'NK Deliveri resevwa yon plent sou yon kòmand resan. Tanpri respekte estanda sèvis nou yo.',
      jsonb_build_object('order_id', v_row.order_id)
    FROM public.drivers dr WHERE v_row.target_type = 'courier' AND dr.id = v_row.target_id
    UNION ALL
    SELECT r.owner_id, 'report_warning', 'Yon avètisman sou sèvis ou',
      'NK Deliveri resevwa yon plent sou yon kòmand resan. Tanpri respekte estanda sèvis nou yo.',
      jsonb_build_object('order_id', v_row.order_id)
    FROM public.restaurants r WHERE v_row.target_type = 'restaurant' AND r.id = v_row.target_id AND r.owner_id IS NOT NULL;
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) request_target_explanation_secure(uuid, text)
CREATE OR REPLACE FUNCTION public.request_target_explanation_secure(_report_id uuid, _question text)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.reports;
  v_target_user uuid;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  UPDATE public.reports SET
    shared_with_target_at = COALESCE(shared_with_target_at, now()),
    target_explanation_question = NULLIF(btrim(_question), ''),
    updated_at = now()
  WHERE id = _report_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'report.explanation_requested',
    jsonb_build_object('report_id', v_row.id));

  IF v_row.target_type = 'courier' THEN
    SELECT dr.user_id INTO v_target_user FROM public.drivers dr WHERE dr.id = v_row.target_id;
  ELSE
    SELECT r.owner_id INTO v_target_user FROM public.restaurants r WHERE r.id = v_row.target_id;
  END IF;
  IF v_target_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_target_user, 'report_explanation_requested', 'Admin mande yon eksplikasyon',
      'Gen yon siyalman sou kòmand ' ||
        (SELECT order_number FROM public.orders WHERE id = v_row.order_id) || '. Tanpri reponn.',
      jsonb_build_object('report_id', v_row.id, 'order_id', v_row.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) get_reports_admin(text, text, text, text, int, int)
CREATE OR REPLACE FUNCTION public.get_reports_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _target_type text DEFAULT NULL,
  _sort text DEFAULT 'created_desc', _limit int DEFAULT 20, _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, order_total numeric,
  reporter_id uuid, reporter_email text,
  target_type public.report_target_type, target_id uuid, target_name text,
  reason_code text, description text, evidence_urls text[],
  status public.report_status, admin_note text, resolution public.report_resolution,
  shared_with_target_at timestamptz, target_explanation_question text,
  target_explanation text, target_explanation_at timestamptz,
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz, updated_at timestamptz,
  target_founded_reports_90d bigint, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.order_id, o.order_number, o.total,
    r.reporter_id, u.email::text,
    r.target_type, r.target_id,
    CASE WHEN r.target_type = 'courier'
      THEN (SELECT trim(both ' ' from coalesce(dr.first_name, '') || ' ' || coalesce(dr.last_name, '')) FROM public.drivers dr WHERE dr.id = r.target_id)
      ELSE (SELECT res.name FROM public.restaurants res WHERE res.id = r.target_id)
    END,
    r.reason_code, r.description, r.evidence_urls,
    r.status, r.admin_note, r.resolution,
    r.shared_with_target_at, r.target_explanation_question, r.target_explanation, r.target_explanation_at,
    r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at,
    (SELECT count(*) FROM public.reports r2
      WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id
        AND r2.status = 'resolved' AND r2.resolution <> 'none'
        AND r2.created_at >= now() - interval '90 days'),
    count(*) OVER() AS total_count
  FROM public.reports r
  JOIN public.orders o ON o.id = r.order_id
  LEFT JOIN auth.users u ON u.id = r.reporter_id
  WHERE (_status IS NULL OR _status = '' OR r.status::text = _status)
    AND (_target_type IS NULL OR _target_type = '' OR r.target_type::text = _target_type)
    AND (
      _search IS NULL OR _search = ''
      OR o.order_number ILIKE '%' || _search || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'created_asc' THEN r.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'updated_desc' THEN r.updated_at END DESC NULLS LAST,
    r.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) get_admin_ai_traffic_stats_secure(text)
CREATE OR REPLACE FUNCTION public.get_admin_ai_traffic_stats_secure(_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int;
  v_since timestamptz;
  v_prev_since timestamptz;
  v_orders_count int;
  v_orders_count_prev int;
  v_revenue numeric;
  v_revenue_prev numeric;
  v_cancelled_count int;
  v_cancelled_count_prev int;
  v_delivered_count int;
  v_avg_basket numeric;
  v_avg_delivery_minutes numeric;
  v_avg_delivery_minutes_prev numeric;
  v_new_restaurants int;
  v_new_drivers int;
  v_open_reports int;
  v_top_restaurants jsonb;
  v_top_dishes jsonb;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_days := CASE _period WHEN 'today' THEN 1 WHEN '7d' THEN 7 WHEN '30d' THEN 30 ELSE NULL END;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'Peryòd envalid';
  END IF;
  v_since := CASE WHEN _period = 'today' THEN date_trunc('day', now())
                  ELSE now() - (v_days || ' days')::interval END;
  v_prev_since := v_since - (v_days || ' days')::interval;

  SELECT count(*), COALESCE(sum(total) FILTER (WHERE status NOT IN ('cancelled', 'refunded')), 0)
  INTO v_orders_count, v_revenue
  FROM public.orders WHERE created_at >= v_since;

  SELECT count(*), COALESCE(sum(total) FILTER (WHERE status NOT IN ('cancelled', 'refunded')), 0)
  INTO v_orders_count_prev, v_revenue_prev
  FROM public.orders WHERE created_at >= v_prev_since AND created_at < v_since;

  SELECT count(*) INTO v_cancelled_count
  FROM public.orders WHERE created_at >= v_since AND status = 'cancelled';
  SELECT count(*) INTO v_cancelled_count_prev
  FROM public.orders WHERE created_at >= v_prev_since AND created_at < v_since AND status = 'cancelled';

  SELECT count(*) INTO v_delivered_count
  FROM public.orders WHERE created_at >= v_since AND status = 'delivered';
  v_avg_basket := CASE WHEN v_delivered_count > 0 THEN round(v_revenue / v_delivered_count, 2) ELSE 0 END;

  SELECT round(avg(extract(epoch FROM (delivered_at - assigned_at)) / 60)::numeric, 1)
  INTO v_avg_delivery_minutes
  FROM public.deliveries
  WHERE delivered_at >= v_since AND delivered_at IS NOT NULL AND assigned_at IS NOT NULL;

  SELECT round(avg(extract(epoch FROM (delivered_at - assigned_at)) / 60)::numeric, 1)
  INTO v_avg_delivery_minutes_prev
  FROM public.deliveries
  WHERE delivered_at >= v_prev_since AND delivered_at < v_since
    AND delivered_at IS NOT NULL AND assigned_at IS NOT NULL;

  SELECT count(*) INTO v_new_restaurants FROM public.restaurants WHERE created_at >= v_since;
  SELECT count(*) INTO v_new_drivers FROM public.drivers WHERE created_at >= v_since;
  SELECT count(*) INTO v_open_reports FROM public.reports WHERE status IN ('open', 'reviewing');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', r.name, 'orders', t.c)), '[]'::jsonb)
  INTO v_top_restaurants
  FROM (
    SELECT restaurant_id, count(*) AS c FROM public.orders
    WHERE created_at >= v_since AND status <> 'cancelled'
    GROUP BY restaurant_id ORDER BY c DESC LIMIT 5
  ) t
  JOIN public.restaurants r ON r.id = t.restaurant_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', d.product_name, 'qty', d.qty)), '[]'::jsonb)
  INTO v_top_dishes
  FROM (
    SELECT oi.product_name, sum(oi.quantity) AS qty
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at >= v_since AND o.status <> 'cancelled'
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5
  ) d;

  RETURN jsonb_build_object(
    'period', _period,
    'since', v_since,
    'orders_count', v_orders_count, 'orders_count_prev', v_orders_count_prev,
    'revenue_htg', v_revenue, 'revenue_htg_prev', v_revenue_prev,
    'cancelled_count', v_cancelled_count, 'cancelled_count_prev', v_cancelled_count_prev,
    'delivered_count', v_delivered_count,
    'avg_basket_htg', v_avg_basket,
    'avg_delivery_minutes', v_avg_delivery_minutes, 'avg_delivery_minutes_prev', v_avg_delivery_minutes_prev,
    'new_restaurants', v_new_restaurants, 'new_drivers', v_new_drivers,
    'open_reports', v_open_reports,
    'top_restaurants', v_top_restaurants,
    'top_dishes', v_top_dishes
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) get_admin_priorities_secure()
CREATE OR REPLACE FUNCTION public.get_admin_priorities_secure()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_reports int;
  v_oldest_report_days int;
  v_pending_contract_restaurants int;
  v_stuck_orders int;
  v_expired_dishes int;
  v_closed_restaurants int;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), COALESCE(max(extract(day FROM now() - created_at))::int, 0)
  INTO v_open_reports, v_oldest_report_days
  FROM public.reports WHERE status IN ('open', 'reviewing');

  SELECT count(*) INTO v_pending_contract_restaurants
  FROM public.restaurants WHERE status = 'pending_contract';

  SELECT count(*) INTO v_stuck_orders
  FROM public.orders WHERE status IN ('pending', 'confirmed') AND created_at < now() - interval '2 hours';

  SELECT count(*) INTO v_expired_dishes
  FROM public.products WHERE expires_at IS NOT NULL AND expires_at < now() AND available = true;

  SELECT count(*) INTO v_closed_restaurants
  FROM public.restaurants
  WHERE is_open = false AND status = 'approved' AND updated_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'open_reports', v_open_reports,
    'oldest_report_days', v_oldest_report_days,
    'pending_contract_restaurants', v_pending_contract_restaurants,
    'stuck_orders', v_stuck_orders,
    'expired_dishes', v_expired_dishes,
    'closed_restaurants', v_closed_restaurants
  );
END;
$$;
