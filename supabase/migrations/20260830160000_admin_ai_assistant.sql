-- TACH 2 (PROMPT MODIFIKASYON — BOUTON WHATSAPP + ASISTAN AI ADMIN) —
-- asistan AI nan dashboard admin nan (API Claude).
--
-- ENVESTIGASYON (avan chanjman) — sa ki DEJA egziste, pa touche/reyekri:
--   - `requireSupabaseAuth` (src/integrations/supabase/auth-middleware.ts) —
--     validasyon JWT Bearer deja etabli, itilize pa TOUT server function
--     ki egziste. Nouvo route API la (route.tsx pa egziste nan estrikti sa
--     a — TanStack Start itilize `src/routes/api.*.ts`, wè
--     api.csp-report.ts/api.webhooks.*.ts pou konvansyon an) repwodwi
--     MENM lojik validasyon JWT a (li pa ka enpòte middleware "function"
--     type la dirèkteman nan yon handler HTTP brit), men VERIFYE wòl admin
--     an PLIS — sa a se yon NOUVO kouch, pa yon ranplasman.
--   - `check_rate_limit_secure` (deja egziste, itilize pou tout lòt limit
--     nan pwojè a) — reyitilize dirèkteman pou limit "50 apèl pa admin pa
--     jou" a, PA yon nouvo tab/kolòn "kantite apèl jodi a" envante.
--   - Modil piblisite a (`sponsored_placements`, dashboard.admin.ads.tsx) —
--     AI a retounen sèlman tèks (tit/deskripsyon/bouton); fòm piblisite ki
--     deja egziste a ki ranpli e ki soumèt via
--     create_sponsored_placement_secure/update_sponsored_placement_secure
--     ki DEJA egziste — okenn chanjman nan modil sa a.
--
-- SA MIGRASYON SA A KREYE (2 tab + 2 RPC agregasyon SÈLMAN — okenn done
-- pèsonèl pa janm soti nan de RPC sa yo, sèlman chif/non biznis):

CREATE TABLE public.ai_usage_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature IN ('summary', 'message', 'ad', 'priorities')),
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_log_admin_id_idx ON public.ai_usage_log(admin_id);
CREATE INDEX ai_usage_log_created_at_idx ON public.ai_usage_log(created_at DESC);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
-- Admin/super_admin wè TOUT itilizasyon (se yon tablo bò konsomasyon
-- ekip la, pa done prive chak moun) — ekriti pase EGZKLIZIVMAN pa
-- `supabaseAdmin` (service_role) nan route API la, jamè dirèkteman pa yon
-- kliyan.
CREATE POLICY "ai_usage_log admin read" ON public.ai_usage_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.ai_usage_log FROM PUBLIC, anon;
GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;

-- Kach rezime jounalye — "yon sèl jenerasyon pa jou pa defo, ak yon bouton
-- Rejenere". UNIQUE(period, cache_date) + upsert (ON CONFLICT DO UPDATE)
-- nan wout API la se sa ki fè "Rejenere" ranplase antre jodi a olye kreye
-- yon dezyèm.
CREATE TABLE public.ai_summary_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL CHECK (period IN ('today', '7d', '30d')),
  cache_date date NOT NULL DEFAULT current_date,
  summary text NOT NULL,
  stats jsonb NOT NULL,
  model text NOT NULL,
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_summary_cache_period_date_unique UNIQUE (period, cache_date)
);
ALTER TABLE public.ai_summary_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_summary_cache admin read" ON public.ai_summary_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.ai_summary_cache FROM PUBLIC, anon;
GRANT SELECT ON public.ai_summary_cache TO authenticated;
GRANT ALL ON public.ai_summary_cache TO service_role;

-- ---------------------------------------------------------------------------
-- 1) Done agrege pou rezime trafik — JAMÈ yon liy pou-kliyan, sèlman chif
-- ak non biznis (restoran/pla). Sa a se sa ki voye bay Claude — okenn imèl,
-- telefòn, adrès ou done peman pa parèt isit la menm.
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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.get_admin_ai_traffic_stats_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_traffic_stats_secure(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Done reyèl pou "Priyorite jodi a" — Claude klase/eksplike, li pa
-- envante okenn nan chif sa yo.
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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.get_admin_priorities_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_priorities_secure() TO authenticated;
