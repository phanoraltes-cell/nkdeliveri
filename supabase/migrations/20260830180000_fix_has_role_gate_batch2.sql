-- FIX (siyale pa Altes, odit sou tout baz la) — swit 2 nan koreksyon
-- 20260830170000: 30 lòt fonksyon `SECURITY DEFINER` nan `public` rele
-- `public.has_role(...)` ANNDAN pwòp kò yo, menm bug la egzakteman (wè nòt
-- konplè + REGLE OBLIGATWA nan docs/DATABASE.md § 3, ajoute nan menm
-- travay sa a).
--
-- METÒD ODIT : pou chak non fonksyon Altes bay, chèche DÈNYE migrasyon ki
-- (re)defini l (`CREATE OR REPLACE` oswa `DROP`+`CREATE`), li kò REYÈL li
-- ki anvigè kounye a, epi klase egzakteman KIJAN gad `has_role` la itilize
-- anvan CREATE OR REPLACE ak `private.has_role` — okenn lòt chanjman
-- lojik, okenn siyati chanje.
--
-- ==========================================================================
-- KLASIFIKASYON (jan Altes mande espesifikman) :
--
-- TIP 1 — "bug senp" (bloke yon admin lejitim, JANM kite yon moun pase kote
-- li pa dwe): 29 nan 30 fonksyon yo. Modèl la se toujou
-- `IF NOT (has_role(...) OR has_role(...)) THEN RAISE EXCEPTION 'Forbidden'`
-- (oswa, pou 3 trigger `protect_*_commission*` yo, yon revèsman/anilasyon
-- SILANSYE — pa yon eksepsyon — men MENM sans lan: chemen ki pi restriktif
-- la ki egzekite lè has_role bay `false` pa erè). Nan tou de ka yo, yon
-- valè `false` bay pa erè fè fonksyon an PI RESTRIKTIF, jamè mwens.
--
-- TIP 2 — RISK REYÈL siyale SEPAREMAN (pa yon "moun pase" nan sans
-- otorizasyon aksyon an, men yon FIT KONFIDANSYALITE) :
--   `add_dispute_message_secure` — `v_is_admin := public.has_role(...)
--   OR public.has_role(...)` itilize pou DESIDE si yon mesaj admin ki
--   mande '_is_internal = true' (yon nòt entèn, pa dwe wè pa kliyan/
--   restoran/livrè) reyèlman anrejistre kòm entèn (`_is_internal AND
--   v_is_admin`). Si `has_role` bay `false` pa erè pou yon vrè admin,
--   `v_is_admin` vin `false`, e mesaj la anrejistre kòm **PA entèn** —
--   li vin VIZIB pou tout pati nan litij la, menm si admin nan te mande
--   li rete konfidansyèl. Sa a se yon FIT KONFIDANSYALITE (enfòmasyon
--   entèn ki ta ka gaye), pa yon "otorizasyon pase" klasik, men li merite
--   yon flag apa jan Altes mande a. Menm koreksyon an (private.has_role)
--   elimine risk la nèt.
--
-- Okenn nan 30 fonksyon yo PA gen yon vrè "twou sekirite" kote `has_role`
-- k ap bay `false` pa erè ta KITE yon moun ki pa dwe pase — chak apèl se
-- yon GAD (chemen restriktif = "false"), jamè yon EGZANSYON (chemen
-- pèmisif = "false"). Sa ki fè sans: yon bug ki fè yon chèk otorizasyon
-- bay FALSE pa aksidan pa ka janm elaji aksè, sèlman retresi l — sof si
-- kòd la ta envès lojik la (has_role=true → OTORIZE aksyon RESTRIKTIF),
-- ki pa ka jwenn nan okenn nan 30 fonksyon sa yo.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1) get_restaurants_missing_hours_admin() — TIP 1
CREATE OR REPLACE FUNCTION public.get_restaurants_missing_hours_admin()
RETURNS TABLE (
  id uuid, name text, slug text, status public.restaurant_status,
  opening_hours_grace_until timestamptz, grace_expired boolean
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
    SELECT r.id, r.name, r.slug, r.status, r.opening_hours_grace_until,
      (r.opening_hours_grace_until IS NULL OR r.opening_hours_grace_until <= now())
    FROM public.restaurants r
    WHERE COALESCE(r.opening_hours, '{}'::jsonb) = '{}'::jsonb
    ORDER BY r.opening_hours_grace_until NULLS FIRST;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) protect_restaurant_commission() — TIP 1 (revèsman silansye, pa eksepsyon)
CREATE OR REPLACE FUNCTION public.protect_restaurant_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  NEW.commission_type := OLD.commission_type;
  NEW.commission_rate := OLD.commission_rate;
  NEW.monthly_commission_amount := OLD.monthly_commission_amount;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) protect_restaurant_commission_insert() — TIP 1 (revèsman silansye)
CREATE OR REPLACE FUNCTION public.protect_restaurant_commission_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  NEW.commission_type := NULL;
  NEW.commission_rate := NULL;
  NEW.monthly_commission_amount := NULL;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) protect_driver_commission() — TIP 1 (revèsman silansye)
CREATE OR REPLACE FUNCTION public.protect_driver_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  NEW.commission_rate := OLD.commission_rate;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) list_partners_admin() — TIP 1
CREATE OR REPLACE FUNCTION public.list_partners_admin()
RETURNS SETOF public.partners
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.partners ORDER BY sort_order ASC, created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) list_promo_codes_admin() — TIP 1
CREATE OR REPLACE FUNCTION public.list_promo_codes_admin()
RETURNS SETOF public.promo_codes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.promo_codes ORDER BY created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) create_partner_secure(text, text, text, int) — TIP 1
CREATE OR REPLACE FUNCTION public.create_partner_secure(
  _name text, _logo_url text, _link_url text DEFAULT NULL, _sort_order int DEFAULT 0
)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.partners;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Non patnè a obligatwa.';
  END IF;
  IF _logo_url IS NULL OR length(btrim(_logo_url)) = 0 THEN
    RAISE EXCEPTION 'Logo a obligatwa.';
  END IF;
  INSERT INTO public.partners (name, logo_url, link_url, sort_order, created_by)
  VALUES (btrim(_name), _logo_url, NULLIF(btrim(_link_url), ''), _sort_order, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) review_refund_secure(uuid, refund_status, text) — TIP 1
CREATE OR REPLACE FUNCTION public.review_refund_secure(_refund_id uuid, _decision refund_status, _admin_notes text)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up();

  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'This refund has already been reviewed';
  END IF;

  UPDATE public.refunds SET
    status = _decision,
    admin_notes = NULLIF(btrim(_admin_notes), ''),
    reviewed_by = v_user,
    reviewed_at = now(),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', _decision, 'by', v_user, 'at', now())
  WHERE id = _refund_id
  RETURNING * INTO v_row;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id,
    'refund_' || _decision,
    CASE WHEN _decision = 'approved' THEN 'Ranbousman apwouve' ELSE 'Ranbousman rejte' END,
    CASE WHEN _decision = 'approved'
      THEN 'Demann ranbousman ou apwouve. Lajan an ap trete.'
      ELSE 'Demann ranbousman ou rejte.' || COALESCE(' Rezon: ' || v_row.admin_notes, '')
    END,
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9) complete_refund_secure(uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.complete_refund_secure(_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
  v_order_status public.order_status;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved refund can be marked completed';
  END IF;

  UPDATE public.refunds SET
    status = 'completed',
    completed_at = now(),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'completed', 'by', v_user, 'at', now())
  WHERE id = _refund_id
  RETURNING * INTO v_row;

  UPDATE public.payments SET status = 'refunded' WHERE id = v_row.payment_id;

  SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id FOR UPDATE;
  UPDATE public.orders SET
    status = 'refunded',
    status_history = status_history || jsonb_build_object(
      'from', v_order_status, 'to', 'refunded', 'by', v_user, 'at', now()
    ),
    updated_at = now()
  WHERE id = v_row.order_id;

  IF v_order_status NOT IN ('cancelled', 'refunded') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_row.order_id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id, 'refund_completed', 'Ranbousman trete',
    'Lajan pou kòmand ou an ranbouse.',
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) resolve_dispute_secure(uuid, text) — TIP 1
CREATE OR REPLACE FUNCTION public.resolve_dispute_secure(_dispute_id uuid, _resolution text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_old_status text;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _resolution IS NULL OR length(btrim(_resolution)) < 3 THEN
    RAISE EXCEPTION 'Tanpri ekri yon rezolisyon';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Litij sa a deja fèmen';
  END IF;
  v_old_status := v_dispute.status;

  UPDATE public.disputes SET
    status = 'resolved', resolution = btrim(_resolution),
    resolved_by = v_user, resolved_at = now(), updated_at = now(),
    status_history = status_history || jsonb_build_object(
      'from', v_old_status, 'to', 'resolved', 'by', v_user, 'at', now(), 'notes', btrim(_resolution)
    )
  WHERE id = _dispute_id
  RETURNING * INTO v_dispute;

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (_dispute_id, v_user, 'admin', btrim(_resolution));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT uid, 'dispute_resolved', 'Litij rezoud',
    'Yon administratè rann yon desizyon sou litij la.',
    jsonb_build_object('order_id', v_dispute.order_id, 'dispute_id', v_dispute.id)
  FROM (
    SELECT v_dispute.customer_id AS uid
    UNION
    SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_dispute.restaurant_id
    UNION
    SELECT dr.user_id FROM public.drivers dr WHERE dr.id = v_dispute.driver_id
  ) parties
  WHERE uid IS NOT NULL;

  RETURN v_dispute;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11) review_manual_payment_secure(uuid, payment_status, text) — TIP 1
CREATE OR REPLACE FUNCTION public.review_manual_payment_secure(
  _payment_id uuid,
  _decision public.payment_status,
  _note text DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payments;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _decision NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Desizyon envalid';
  END IF;

  SELECT * INTO v_row FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_row.status NOT IN ('awaiting_proof', 'under_review') THEN
    RAISE EXCEPTION 'Peman sa a deja trete (estati aktyèl: %)', v_row.status USING ERRCODE = '42501';
  END IF;

  UPDATE public.payments
  SET status = _decision,
      review_notes = NULLIF(btrim(COALESCE(_note, '')), ''),
      reviewed_by = v_user,
      reviewed_at = now()
  WHERE id = _payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12) update_partner_secure(uuid, text, text, text, int, boolean) — TIP 1
CREATE OR REPLACE FUNCTION public.update_partner_secure(
  _id uuid, _name text, _logo_url text, _link_url text, _sort_order int, _is_active boolean
)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.partners;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Non patnè a obligatwa.';
  END IF;
  IF _logo_url IS NULL OR length(btrim(_logo_url)) = 0 THEN
    RAISE EXCEPTION 'Logo a obligatwa.';
  END IF;
  UPDATE public.partners SET
    name = btrim(_name), logo_url = _logo_url, link_url = NULLIF(btrim(_link_url), ''),
    sort_order = _sort_order, is_active = _is_active
  WHERE id = _id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patnè pa jwenn'; END IF;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 13) delete_partner_secure(uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.delete_partner_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.partners WHERE id = _id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 14) delete_sponsored_placement_secure(uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.delete_sponsored_placement_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sponsored_placements WHERE id = _id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 15) anonymize_customer_secure(uuid, text) — TIP 1
CREATE OR REPLACE FUNCTION public.anonymize_customer_secure(_customer_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF NOT (private.has_role(v_admin, 'admin') OR private.has_role(v_admin, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_admin_step_up_strict();

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Kont kliyan an obligatwa.';
  END IF;
  IF _customer_id = v_admin THEN
    RAISE EXCEPTION 'Ou pa ka anonimize pwòp kont ou.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _customer_id AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'Kont sa a pa gen wòl kliyan.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _customer_id AND role <> 'customer'
  ) THEN
    RAISE EXCEPTION 'Zouti sa a sèlman pou kont ki gen sèlman wòl kliyan (NKD-020, pòte limite).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _customer_id AND anonymized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Kont sa a deja anonimize.';
  END IF;

  UPDATE public.profiles
  SET first_name = '[Efase]',
      last_name = NULL,
      phone = NULL,
      address = NULL,
      avatar_url = NULL,
      anonymized_at = now(),
      anonymized_by = v_admin
  WHERE id = _customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pwofil pa jwenn.';
  END IF;

  UPDATE public.addresses
  SET label = NULL, address_line = '[Efase]', notes = NULL, lat = NULL, lng = NULL
  WHERE user_id = _customer_id;

  DELETE FROM public.favorites WHERE user_id = _customer_id;
  DELETE FROM public.push_subscriptions WHERE user_id = _customer_id;

  DELETE FROM public.customer_delivery_locations cdl
    USING public.deliveries d, public.orders o
    WHERE cdl.delivery_id = d.id AND d.order_id = o.id AND o.customer_id = _customer_id;

  PERFORM private.log_audit_event(v_admin, 'admin', 'customer_anonymized',
    jsonb_build_object('customer_id', _customer_id, 'reason', _reason));
END;
$$;

-- ---------------------------------------------------------------------------
-- 16) create_contract_version_secure(text, text) — TIP 1
CREATE OR REPLACE FUNCTION public.create_contract_version_secure(_content text, _contract_type text)
RETURNS public.contract_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contract_versions;
  v_next_version int;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _contract_type NOT IN ('restaurant', 'driver') THEN
    RAISE EXCEPTION 'Tip kontra envalid.';
  END IF;
  IF _content IS NULL OR length(btrim(_content)) = 0 THEN
    RAISE EXCEPTION 'Tèks kontra a obligatwa.';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.contract_versions WHERE contract_type = _contract_type;

  INSERT INTO public.contract_versions (version, content, contract_type, created_by)
  VALUES (v_next_version, _content, _contract_type, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 17) create_promo_code_secure(text, text, numeric, numeric, int, timestamptz, timestamptz) — TIP 1
CREATE OR REPLACE FUNCTION public.create_promo_code_secure(
  _code text,
  _discount_type text,
  _discount_value numeric,
  _min_order_amount numeric DEFAULT NULL,
  _max_uses int DEFAULT NULL,
  _starts_at timestamptz DEFAULT NULL,
  _ends_at timestamptz DEFAULT NULL
)
RETURNS public.promo_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promo_codes;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR length(btrim(_code)) = 0 THEN
    RAISE EXCEPTION 'Kòd pwomo a obligatwa.';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Tip rabè envalid.';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Valè rabè a dwe pi gran pase 0.';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Rabè an pousantaj pa ka depase 100%%.';
  END IF;

  INSERT INTO public.promo_codes (
    code, discount_type, discount_value, min_order_amount, max_uses, starts_at, ends_at, created_by
  ) VALUES (
    upper(btrim(_code)), _discount_type, _discount_value, _min_order_amount, _max_uses, _starts_at, _ends_at, auth.uid()
  )
  RETURNING * INTO v_row;
  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Kòd pwomo "%" deja egziste.', upper(btrim(_code));
END;
$$;

-- ---------------------------------------------------------------------------
-- 18) revoke_restaurant_contract_secure(uuid, text) — TIP 1
CREATE OR REPLACE FUNCTION public.revoke_restaurant_contract_secure(_restaurant_id uuid, _reason text)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signature_id uuid;
  v_row public.restaurants;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_signature_id FROM public.contract_signatures
    WHERE restaurant_id = _restaurant_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restoran sa a pa gen okenn siyati aktif pou revoke.';
  END IF;

  UPDATE public.contract_signatures
  SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = NULLIF(btrim(_reason), '')
  WHERE id = v_signature_id;

  UPDATE public.restaurants SET status = 'pending_contract'
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(auth.uid(), 'admin', 'restaurant_contract.revoked',
    jsonb_build_object('restaurant_id', _restaurant_id, 'reason', _reason));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 19) add_dispute_message_secure(uuid, text, boolean, text) — TIP 2 (siyale
-- apa: FIT KONFIDANSYALITE, pa yon "otorizasyon pase" — wè nòt konplè anwo).
CREATE OR REPLACE FUNCTION public.add_dispute_message_secure(
  _dispute_id uuid, _message text, _is_internal boolean DEFAULT false, _attachment_url text DEFAULT NULL
)
RETURNS public.dispute_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_role public.dispute_author_role;
  v_is_admin boolean;
  v_row public.dispute_messages;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _message IS NULL OR length(btrim(_message)) = 0 THEN
    RAISE EXCEPTION 'Message pa ka vid';
  END IF;

  IF NOT public.check_rate_limit_secure('add_dispute_message', 20, 600) THEN
    RAISE EXCEPTION 'Twòp mesaj. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;

  v_role := private.dispute_author_role(v_dispute);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_dispute.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Litij sa a deja fèmen';
  END IF;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message, is_internal, attachment_url)
  VALUES (_dispute_id, v_user, v_role, btrim(_message), _is_internal AND v_is_admin, _attachment_url)
  RETURNING * INTO v_row;

  UPDATE public.disputes SET updated_at = now() WHERE id = _dispute_id;

  IF NOT v_row.is_internal THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT DISTINCT uid, 'dispute_message', 'Nouvo repons nan yon litij',
      'Gen yon nouvo mesaj nan litij sou kòmand ou.',
      jsonb_build_object('order_id', v_dispute.order_id, 'dispute_id', v_dispute.id)
    FROM (
      SELECT v_dispute.customer_id AS uid
      UNION
      SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_dispute.restaurant_id
      UNION
      SELECT dr.user_id FROM public.drivers dr WHERE dr.id = v_dispute.driver_id
    ) parties
    WHERE uid IS NOT NULL AND uid <> v_user;
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 20) approve_driver_pending_contract_secure(uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.approve_driver_pending_contract_secure(_driver_id uuid)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.drivers;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.drivers SET status = 'approved', account_status = 'pending_contract'
  WHERE id = _driver_id AND status = 'pending'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Livrè sa a pa nan etap "an atant" kounye a.';
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 21) update_dispute_status_secure(uuid, text, text, uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.update_dispute_status_secure(
  _dispute_id uuid, _status text, _admin_notes text DEFAULT NULL, _assigned_to uuid DEFAULT NULL
)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_old_status text;
  v_status_changed boolean;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('open', 'in_review', 'action_required', 'rejected', 'escalated') THEN
    RAISE EXCEPTION 'Estati sa a envalid pou aksyon sa a';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  v_old_status := v_dispute.status;
  v_status_changed := v_old_status <> _status;
  IF NOT v_status_changed AND _assigned_to IS NULL THEN
    RAISE EXCEPTION 'Anyen pa chanje';
  END IF;

  UPDATE public.disputes SET
    status = _status,
    assigned_to = COALESCE(_assigned_to, assigned_to),
    status_history = CASE WHEN v_status_changed THEN
      status_history || jsonb_build_object(
        'from', v_old_status, 'to', _status, 'by', v_user, 'at', now(), 'notes', _admin_notes
      )
      ELSE status_history END,
    updated_at = now()
  WHERE id = _dispute_id
  RETURNING * INTO v_dispute;

  IF v_status_changed AND _admin_notes IS NOT NULL AND length(btrim(_admin_notes)) > 0 THEN
    INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message, is_internal)
    VALUES (_dispute_id, v_user, 'admin', btrim(_admin_notes), true);
  END IF;

  IF v_status_changed THEN
    PERFORM private.log_audit_event(v_user, 'admin', 'dispute.status_changed',
      jsonb_build_object('dispute_id', _dispute_id, 'from', v_old_status, 'to', _status));
  ELSE
    PERFORM private.log_audit_event(v_user, 'admin', 'dispute.assigned',
      jsonb_build_object('dispute_id', _dispute_id, 'assigned_to', _assigned_to));
  END IF;

  RETURN v_dispute;
END;
$$;

-- ---------------------------------------------------------------------------
-- 22) get_disputes_admin(text, text, text, text, int, int) — TIP 1
CREATE OR REPLACE FUNCTION public.get_disputes_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _category_group text DEFAULT NULL,
  _sort text DEFAULT 'created_desc', _limit int DEFAULT 20, _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, category text, category_group text,
  status text, customer_id uuid, restaurant_id uuid, restaurant_name text,
  driver_id uuid, driver_first_name text, driver_last_name text,
  assigned_to uuid, assigned_email text, resolution text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
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
    d.id, d.order_id, o.order_number, d.category, d.category_group, d.status,
    d.customer_id, d.restaurant_id, r.name, d.driver_id, dr.first_name, dr.last_name,
    d.assigned_to, u.email::text, d.resolution, d.created_at, d.updated_at,
    count(*) OVER() AS total_count
  FROM public.disputes d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.restaurants r ON r.id = d.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = d.driver_id
  LEFT JOIN auth.users u ON u.id = d.assigned_to
  WHERE (_status IS NULL OR _status = '' OR d.status = _status)
    AND (_category_group IS NULL OR _category_group = '' OR d.category_group = _category_group)
    AND (
      _search IS NULL OR _search = ''
      OR o.order_number ILIKE '%' || _search || '%'
      OR r.name ILIKE '%' || _search || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'created_asc' THEN d.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'updated_desc' THEN d.updated_at END DESC NULLS LAST,
    d.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

-- ---------------------------------------------------------------------------
-- 23) send_promotional_notification_secure(text, text, text, text, jsonb, int) — TIP 1
CREATE OR REPLACE FUNCTION public.send_promotional_notification_secure(
  _title text, _body text, _target_role text DEFAULT 'all', _target_city text DEFAULT NULL,
  _data jsonb DEFAULT '{}'::jsonb, _cooldown_hours int DEFAULT 24
)
RETURNS public.promotional_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_recipients uuid[];
  v_row public.promotional_notifications;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tit la obligatwa';
  END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN
    RAISE EXCEPTION 'Kontni a obligatwa';
  END IF;
  IF _target_role NOT IN ('all', 'customer', 'restaurant_owner', 'driver') THEN
    RAISE EXCEPTION 'Sib envalid';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT p.id FROM public.profiles p
    WHERE (
      _target_role = 'all'
      OR (_target_role = 'customer' AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id))
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _target_role)
    )
    AND (_target_city IS NULL OR btrim(_target_city) = '' OR p.address ILIKE '%' || _target_city || '%')
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.id AND n.category = 'promotion'
        AND n.created_at > now() - make_interval(hours => GREATEST(_cooldown_hours, 1))
    )
  ) INTO v_recipients;

  INSERT INTO public.promotional_notifications
    (title, body, target_role, target_city, data, sent_by, recipient_count)
  VALUES (
    btrim(_title), btrim(_body), _target_role, NULLIF(btrim(_target_city), ''), _data, v_user,
    COALESCE(array_length(v_recipients, 1), 0)
  )
  RETURNING * INTO v_row;

  PERFORM private.notify_secure(
    v_recipients, 'promotional_notification', 'promotion', btrim(_title), btrim(_body), _data
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 24) update_promo_code_secure(uuid, text, numeric, numeric, int, timestamptz, timestamptz, boolean) — TIP 1
CREATE OR REPLACE FUNCTION public.update_promo_code_secure(
  _id uuid,
  _discount_type text,
  _discount_value numeric,
  _min_order_amount numeric,
  _max_uses int,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _active boolean
)
RETURNS public.promo_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promo_codes;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Tip rabè envalid.';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Valè rabè a dwe pi gran pase 0.';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Rabè an pousantaj pa ka depase 100%%.';
  END IF;

  UPDATE public.promo_codes SET
    discount_type = _discount_type,
    discount_value = _discount_value,
    min_order_amount = _min_order_amount,
    max_uses = _max_uses,
    starts_at = _starts_at,
    ends_at = _ends_at,
    active = _active,
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kòd pwomo pa jwenn'; END IF;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 25) delete_promo_code_secure(uuid) — TIP 1
CREATE OR REPLACE FUNCTION public.delete_promo_code_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.promo_codes WHERE id = _id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 26) update_delivery_zone_fee_secure(uuid, numeric) — TIP 1
CREATE OR REPLACE FUNCTION public.update_delivery_zone_fee_secure(_zone_id uuid, _fee_htg numeric)
RETURNS public.platform_delivery_zones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.platform_delivery_zones;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_admin_step_up();

  IF _fee_htg IS NULL OR _fee_htg < 0 THEN
    RAISE EXCEPTION 'Pri livrezon an dwe yon chif pozitif oswa zewo.';
  END IF;

  UPDATE public.platform_delivery_zones
  SET fee_htg = _fee_htg, updated_at = now(), updated_by = v_user
  WHERE id = _zone_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zòn sa a pa jwenn.';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'delivery_zone.fee_updated',
    jsonb_build_object('zone_id', v_row.id, 'new_fee_htg', v_row.fee_htg));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 27) report_delivery_failed_secure(uuid, text, text) — TIP 1 (chemen livrè
-- asiyen an pa afekte, sèlman chemen admin nan bloke pa erè)
CREATE OR REPLACE FUNCTION public.report_delivery_failed_secure(
  _order_id uuid,
  _reason text,
  _comment text DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_delivery public.deliveries;
  v_is_admin boolean;
  v_is_assigned_driver boolean;
  v_comment text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('report_delivery_failed', 20, 3600) THEN
    RAISE EXCEPTION 'Twòp rapò nan yon ti tan. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  IF _reason NOT IN ('customer_unavailable', 'address_not_found', 'zone_inaccessible', 'other') THEN
    RAISE EXCEPTION 'Rezon an pa valid.';
  END IF;
  v_comment := NULLIF(btrim(_comment), '');
  IF _reason = 'other' AND v_comment IS NULL THEN
    RAISE EXCEPTION 'Tanpri esplike rezon an lè w chwazi "lòt".';
  END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE order_id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Livrezon pa jwenn.';
  END IF;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_delivery.driver_id AND d.user_id = v_user
  );
  IF NOT (v_is_admin OR v_is_assigned_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_delivery.status NOT IN ('picked_up', 'en_route_dropoff') THEN
    RAISE EXCEPTION 'Ou pa ka siyale yon echèk livrezon nan eta sa a.';
  END IF;

  UPDATE public.deliveries
     SET status = 'delivery_failed',
         failure_reason = _reason,
         failure_comment = v_comment,
         updated_at = now()
   WHERE id = v_delivery.id
   RETURNING * INTO v_delivery;

  PERFORM private.log_audit_event(v_user, CASE WHEN v_is_admin THEN 'admin' ELSE 'driver' END,
    'delivery.failed', jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason));

  INSERT INTO public.notifications (user_id, type, category, title, body, data)
  SELECT o.customer_id, 'order_status_changed', 'order', 'Nou pa t ka livre kòmand ou a',
    'Nou pa t ka livre kòmand ' || o.order_number || '. Manje a ap tann ou nan biwo nou an pou 2 èdtan.',
    jsonb_build_object('order_id', o.id, 'status', 'delivery_failed')
  FROM public.orders o WHERE o.id = _order_id;

  PERFORM private.notify_secure(
    ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
    'delivery_failed', 'order', 'Yon livrezon echwe',
    'Livrezon pou kòmand ' || (SELECT order_number FROM public.orders WHERE id = _order_id) || ' echwe — rezon: ' || _reason || '.',
    jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason)
  );

  RETURN v_delivery;
END;
$$;

-- ---------------------------------------------------------------------------
-- 28) create_sponsored_placement_secure(...) — TIP 1
CREATE OR REPLACE FUNCTION public.create_sponsored_placement_secure(
  _placement text,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _restaurant_id uuid DEFAULT NULL,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL,
  _is_active boolean DEFAULT true,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _placement NOT IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard', 'popup') THEN
    RAISE EXCEPTION 'Anplasman envalid';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  INSERT INTO public.sponsored_placements (
    placement, restaurant_id, title, image_url, link_url, starts_at, ends_at, sort_order, created_by,
    media_type, media_url, media_path, thumbnail_url, media_items, alt_text, link_target, cta_label,
    description, is_active, media_width, media_height
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active, _media_width, _media_height
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 29) update_sponsored_placement_secure(...) — TIP 1
CREATE OR REPLACE FUNCTION public.update_sponsored_placement_secure(
  _id uuid,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _is_active boolean,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  UPDATE public.sponsored_placements SET
    title = btrim(_title), image_url = v_media_url, link_url = _link_url,
    starts_at = _starts_at, ends_at = _ends_at, is_active = _is_active, sort_order = _sort_order,
    media_type = _media_type, media_url = v_media_url, media_path = _media_path,
    thumbnail_url = _thumbnail_url, media_items = _media_items, alt_text = _alt_text,
    link_target = _link_target, cta_label = _cta_label, description = btrim(_description),
    media_width = _media_width, media_height = _media_height
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 30) revoke_driver_contract_secure(uuid, text) — TIP 1
CREATE OR REPLACE FUNCTION public.revoke_driver_contract_secure(_driver_id uuid, _reason text)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signature_id uuid;
  v_row public.drivers;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_signature_id FROM public.contract_signatures
    WHERE driver_id = _driver_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Livrè sa a pa gen okenn siyati aktif pou revoke.';
  END IF;

  UPDATE public.contract_signatures
  SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = NULLIF(btrim(_reason), '')
  WHERE id = v_signature_id;

  UPDATE public.drivers SET account_status = 'pending_contract'
  WHERE id = _driver_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(auth.uid(), 'admin', 'driver_contract.revoked',
    jsonb_build_object('driver_id', _driver_id, 'reason', _reason));

  RETURN v_row;
END;
$$;

-- Menm siyati egzat pou chak nan 30 fonksyon yo — CREATE OR REPLACE san
-- danje, pa gen okenn DROP FUNCTION/GRANT/REVOKE nesesè (privilèj yo rete
-- atache a objè fonksyon an, yo pa reset pa CREATE OR REPLACE).
