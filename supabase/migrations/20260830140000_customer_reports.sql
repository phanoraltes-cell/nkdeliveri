-- TACH 1 (PROMPT MODIFIKASYON — SIYALMAN + NOTIFIKASYON) — kliyan ka siyale
-- (repòte) yon livrè oswa yon restoran sou yon kòmand.
--
-- POUKISA SA A SE YON NOUVO SISTÈM SEPARE, PA YON EKSTANSYON `disputes`:
-- Pwojè a deja gen yon sistèm `disputes`/`dispute_messages`
-- (20260714131500_disputes.sql, elaji 20260722210000) ki DEJA MACHE byen
-- pou objektif pa li: yon "chat" kolaboratif SOU YON KÒMAND kote kliyan,
-- restoran, livrè AK admin tout wè e ekri nan MENM fil la, pou rezoud yon
-- pwoblèm ansanm. Nou pa touche l — li rete egzakteman jan l ye a.
--
-- Tach sa a mande yon bagay diferan nan REY: yon "siyalman" se yon plent
-- KONFIDANSYÈL kont YON SIB SPESIFIK (livrè oswa restoran, oswa toude
-- separeman), kote:
--   - sib la (livrè/restoran) PA gen aksè otomatik ni nan dosye a ni nan
--     idantite kliyan an — sèl admin wè tout bagay, e se admin ki chwazi
--     pataje yon vèsyon FILTRE (kòmand#, rezon, deskripsyon — JANM idantite
--     kliyan an) ak sib la si li deside sa.
--   - rezon yo diferan selon si w ap siyale restoran an oswa livrè a.
--   - gen prèv foto, yon delè 7 jou, yon limit anti-abi, ak yon konsekans
--     operasyonèl (avètisman/ranbouse/sispansyon) ki mennen nan yon jounal
--     odit.
-- Modèl vizibilite "tout moun wè tout bagay" ki nan `disputes` la ta VYOLE
-- eksijans konfidansyalite sa a si nou te eseye reyisi l ladan l. Kidonk:
-- de tab/sistèm SEPARE, chak youn ak wòl klè, pa yon duplikasyon — yo pa
-- fè menm travay la.

-- ---------------------------------------------------------------------------
-- 1) Tip ak tab yo.

CREATE TYPE public.report_target_type AS ENUM ('courier', 'restaurant');
CREATE TYPE public.report_status AS ENUM ('open', 'reviewing', 'resolved', 'rejected');
CREATE TYPE public.report_resolution AS ENUM ('none', 'warning', 'refund', 'partial_refund', 'suspension');
CREATE TYPE public.report_message_author AS ENUM ('customer', 'admin');

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- `target_id` rezoud SOU SÈVÈ a (nan create_report_secure), jamè pase pa
  -- kliyan an: pou 'restaurant' se orders.restaurant_id, pou 'courier' se
  -- deliveries.driver_id pou menm kòmand la. Sa anpeche yon kliyan siyale
  -- yon sib ki pa gen okenn rapò ak kòmand li a.
  target_type public.report_target_type NOT NULL,
  target_id uuid NOT NULL,
  reason_code text NOT NULL,
  description text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}',
  status public.report_status NOT NULL DEFAULT 'open',
  admin_note text,
  resolution public.report_resolution NOT NULL DEFAULT 'none',
  -- Pa NULL sèlman apre admin chwazi "mande yon eksplikasyon" (aksyon ki
  -- pataje yon vèsyon FILTRE dosye a ak sib la) — jamè otomatik.
  shared_with_target_at timestamptz,
  target_explanation_question text,
  target_explanation text,
  target_explanation_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_reporter_id_idx ON public.reports(reporter_id);
CREATE INDEX reports_target_idx ON public.reports(target_type, target_id);
CREATE INDEX reports_order_id_idx ON public.reports(order_id);
CREATE INDEX reports_status_idx ON public.reports(status);
-- "Yon sèl siyalman AKTIF pa kòmand pa sib" — index pasyèl (pa yon UNIQUE
-- plen) espre: yon dosye ki deja rezoud/rejte pa dwe bloke yon NOUVO
-- pwoblèm sou menm kòmand/sib la pou tout tan, sèlman pandan l "aktif"
-- (open/reviewing). Menm apwòch ak disputes_order_unique, men pa sib olye
-- pa kòmand sèlman (yon kòmand ka gen 2 siyalman aktif — youn pou
-- restoran, youn pou livrè — an menm tan, "Tou de" nan fòm lan kreye 2 ranje).
CREATE UNIQUE INDEX reports_one_active_per_target_idx ON public.reports(order_id, target_type, target_id)
  WHERE status IN ('open', 'reviewing');

CREATE TABLE public.report_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  author_role public.report_message_author NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_messages_report_id_idx ON public.report_messages(report_id, created_at);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;

-- Li sèlman via RLS (rapòtè a oswa admin) — okenn INSERT/UPDATE policy:
-- chak ekriti pase pa yon RPC SECURITY DEFINER, menm konvansyon ak
-- disputes/refunds. SIB LA (restoran/livrè) PA gen okenn wè dirèk isit la
-- — sèl aksè pa li se RPC `get_shared_reports_for_target_secure()` pi ba,
-- ki retounen yon vèsyon FILTRE (jamè `reporter_id`).
CREATE POLICY "reports read" ON public.reports FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "report_messages read" ON public.report_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r WHERE r.id = report_messages.report_id
        AND (
          r.reporter_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'super_admin')
        )
    )
  );

REVOKE ALL ON public.reports FROM PUBLIC, anon;
REVOKE ALL ON public.report_messages FROM PUBLIC, anon;
GRANT SELECT ON public.reports TO authenticated;
GRANT SELECT ON public.report_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Bucket prive pou prèv (foto sèlman, jiska 3, egzije pa 8MB/foto —
-- menm plafon ak driver-documents/payment-proofs). Pa piblik: sèl moun ki
-- depoze a ak admin ka wè yo (URL siyen via ProofThumb, ekspire).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-evidence', 'report-evidence', false, 8 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "report_evidence_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'report-evidence' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));
CREATE POLICY "report_evidence_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'report-evidence' AND owner = auth.uid());
CREATE POLICY "report_evidence_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'report-evidence' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));

-- ---------------------------------------------------------------------------
-- 3) Kliyan kreye yon siyalman — 5 pa 24 è (anti-abi, wè spec), + verifye
-- posesyon kòmand la, estati final, ak delè 7 jou sou sèvè a (jamè fè
-- konfyans a kliyan an pou okenn nan sa yo).
CREATE OR REPLACE FUNCTION public.create_report_secure(
  _order_id uuid, _target_type text, _reason_code text, _description text,
  _evidence_urls text[] DEFAULT '{}'
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_target_type public.report_target_type;
  v_target_id uuid;
  v_row public.reports;
  v_reason_codes text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_target_type := _target_type::public.report_target_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Sib envalid';
  END;

  IF _description IS NULL OR length(btrim(_description)) < 20 THEN
    RAISE EXCEPTION 'Deskripsyon an dwe gen omwen 20 karaktè';
  END IF;
  IF array_length(_evidence_urls, 1) IS NOT NULL AND array_length(_evidence_urls, 1) > 3 THEN
    RAISE EXCEPTION 'Maksimòm 3 foto';
  END IF;

  -- Rezon yo diferan selon sib la — lis fiks, verifye sou sèvè a (pa nan
  -- frontend sèlman), egzakteman jan spec la bay yo.
  v_reason_codes := CASE v_target_type
    WHEN 'restaurant' THEN ARRAY[
      'food_not_good', 'incomplete_order', 'wrong_dish', 'cold_food',
      'hygiene_issue', 'long_prep_delay', 'incorrect_price'
    ]
    WHEN 'courier' THEN ARRAY[
      'long_delay', 'never_arrived', 'bad_behavior', 'damaged_order',
      'extra_money_demanded', 'wrong_address'
    ]
  END;
  IF NOT (_reason_code = ANY(v_reason_codes)) THEN
    RAISE EXCEPTION 'Rezon envalid pou sib sa a';
  END IF;

  IF NOT public.check_rate_limit_secure('create_report', 5, 86400) THEN
    RAISE EXCEPTION 'Ou rive nan limit siyalman (5 pa 24 è). Tanpri eseye pita.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id AND customer_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Ou ka siyale sèlman yon kòmand ki livre oswa anile';
  END IF;
  -- 7 jou apre — `updated_at` reflete moman kòmand la antre nan estati
  -- final la (delivered/cancelled), paske li pa chanje ankò apre sa.
  IF v_order.updated_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Delè 7 jou a pase pou kòmand sa a' USING ERRCODE = '42901';
  END IF;

  IF v_target_type = 'restaurant' THEN
    v_target_id := v_order.restaurant_id;
  ELSE
    SELECT de.driver_id INTO v_target_id
    FROM public.deliveries de WHERE de.order_id = _order_id;
    IF v_target_id IS NULL THEN
      RAISE EXCEPTION 'Pa gen livrè ki asiyen sou kòmand sa a';
    END IF;
  END IF;

  INSERT INTO public.reports (order_id, reporter_id, target_type, target_id, reason_code, description, evidence_urls)
  VALUES (_order_id, v_user, v_target_type, v_target_id, _reason_code, btrim(_description), COALESCE(_evidence_urls, '{}'))
  ON CONFLICT (order_id, target_type, target_id) WHERE status IN ('open', 'reviewing')
  DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- "Montre dosye ki egziste a olye pou kreye yon lòt" — pa yon erè,
    -- retounen dosye aktif ki egziste a pou frontend la afiche l.
    SELECT * INTO v_row FROM public.reports
    WHERE order_id = _order_id AND target_type = v_target_type AND target_id = v_target_id
      AND status IN ('open', 'reviewing');
    RETURN v_row;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'report_opened', 'Nouvo siyalman #' || left(v_row.id::text, 8),
    'Kòmand ' || v_order.order_number || ' · kont ' ||
      (CASE v_target_type WHEN 'courier' THEN 'livrè' ELSE 'restoran' END) ||
      ' · ' || _reason_code,
    jsonb_build_object('report_id', v_row.id, 'order_id', v_order.id)
  FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_report_secure(uuid, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_report_secure(uuid, text, text, text, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Fil mesaj admin<->kliyan (SÈLMAN — sib la pa patisipe isit la, wè
-- request/submit_target_explanation pi ba pou kanal SEPARE ak sib la).
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

  v_is_admin := public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin');
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
REVOKE ALL ON FUNCTION public.add_report_message_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_report_message_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Admin chanje estati (san rezolisyon final) + nòt.
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
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.set_report_status_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_report_status_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Admin rejte dosye a.
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
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.reject_report_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_report_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Admin rezoud dosye a AK yon rezolisyon operasyonèl.
-- IMPORTANT — limit eksplisit sou 2 rezolisyon:
--   'refund'/'partial_refund' ANREJISTRE sèlman DESIZYON an sou dosye a
--   (etikèt/klasifikasyon pou rapò/odit) — li PA deplase lajan otomatikman.
--   Ranbousman reyèl la ap pase pa sistèm `refunds` ki DEJA egziste
--   (request_refund_secure/review_refund_secure/complete_refund_secure,
--   20260714130000_refunds.sql) — sistèm sa a mande yon `payment_id`/yon
--   demann kliyan deja, li pa ka deklannche pa yon aksyon admin dirèk san
--   nou pa CHANJE sistèm refund ki DEJA MACHE a, sa ki t ap sòti nan objè
--   tach sa a (dashboard admin ap gen yon lyen rapid pou ale nan zouti
--   ranbousman kòmand la separeman).
--   'suspension' OTOMATIK reyèl: rele DIREKTEMAN
--   update_driver_status_secure/update_restaurant_status_secure ki DEJA
--   egziste — pa gen okenn nouvo lojik sispansyon envante isit la.
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
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
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

  -- Notifikasyon avètisman jenerik bay sib la — jamè idantite kliyan an,
  -- menm si dosye a poko "pataje" (yon avètisman jeneral sou estanda
  -- sèvis pa revele okenn detay konfidansyèl).
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
REVOKE ALL ON FUNCTION public.resolve_report_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_report_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) Admin mande yon eksplikasyon bay sib la — sa a se SÈL mwayen sib la
-- vin gen aksè (limite, filtre) a dosye a. Jamè otomatik.
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
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.request_target_explanation_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_target_explanation_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Sib la (livrè/restoran) soumèt eksplikasyon li — SÈLMAN si li se vre
-- sib la SOU dosye sa a, e SÈLMAN si admin deja pataje l (shared_with_target_at).
CREATE OR REPLACE FUNCTION public.submit_target_explanation_secure(_report_id uuid, _explanation text)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.reports;
  v_is_target boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _explanation IS NULL OR length(btrim(_explanation)) = 0 THEN
    RAISE EXCEPTION 'Eksplikasyon an pa ka vid';
  END IF;

  SELECT * INTO v_row FROM public.reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;
  IF v_row.shared_with_target_at IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_row.target_type = 'courier' THEN
    v_is_target := EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.id = v_row.target_id AND dr.user_id = v_user);
  ELSE
    v_is_target := EXISTS (
      SELECT 1 FROM public.restaurants r WHERE r.id = v_row.target_id AND r.owner_id = v_user
      UNION ALL
      SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = v_row.target_id AND e.user_id = v_user
    );
  END IF;
  IF NOT v_is_target THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reports SET
    target_explanation = btrim(_explanation), target_explanation_at = now(), updated_at = now()
  WHERE id = _report_id
  RETURNING * INTO v_row;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'report_message', 'Repons resevwa sou yon siyalman',
    'Sib la reponn dosye #' || left(v_row.id::text, 8) || '.',
    jsonb_build_object('report_id', v_row.id, 'order_id', v_row.order_id)
  FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_target_explanation_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_target_explanation_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) Vèsyon FILTRE pou sib la wè dosye ki pataje ak li — JAMÈ reporter_id,
-- non, oswa kontak kliyan an nan Returns la.
CREATE OR REPLACE FUNCTION public.get_shared_reports_for_target_secure()
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, target_type public.report_target_type,
  reason_code text, description text, status public.report_status,
  target_explanation_question text, target_explanation text, target_explanation_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.order_id, o.order_number, r.target_type, r.reason_code, r.description, r.status,
    r.target_explanation_question, r.target_explanation, r.target_explanation_at, r.created_at
  FROM public.reports r
  JOIN public.orders o ON o.id = r.order_id
  WHERE r.shared_with_target_at IS NOT NULL
    AND (
      (r.target_type = 'courier' AND EXISTS (
        SELECT 1 FROM public.drivers dr WHERE dr.id = r.target_id AND dr.user_id = v_user
      ))
      OR (r.target_type = 'restaurant' AND EXISTS (
        SELECT 1 FROM public.restaurants res WHERE res.id = r.target_id AND res.owner_id = v_user
        UNION ALL
        SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = r.target_id AND e.user_id = v_user
      ))
    )
  ORDER BY r.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_shared_reports_for_target_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_reports_for_target_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) Lis + filtè pou dashboard admin — menm modèl ak get_disputes_admin
-- (count(*) OVER() pou total_count, wè 20260810110000 pou poukisa
-- u.email egzije yon ::text eksplisit).
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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.get_reports_admin(text, text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reports_admin(text, text, text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12) Realtime — menm modèl idanpotan ak 20260714122000_notifications_realtime.sql.
ALTER TABLE public.reports REPLICA IDENTITY FULL;
ALTER TABLE public.report_messages REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'report_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.report_messages;
  END IF;
END $$;
