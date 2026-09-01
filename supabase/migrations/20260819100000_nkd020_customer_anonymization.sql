-- NKD-020 — chemen efasman done pou kliyan (Faz 11, docs/archive/phases/PHASE11_COMPLIANCE_AUDIT.md).
-- Règ A4 leve (seri odit Faz 3-11 fèmen). A5: touche done kliyan reyèl —
-- prezante anvan aplikasyon, pa aplike san otorizasyon eksplisit.
--
-- Konfime dirèkteman nan schema a (pa sipozisyon): yon DELETE fizik sou
-- auth.users deja ENPOSIB jodi a pou nenpòt kliyan ki gen omwen yon kòmand
-- — orders.customer_id REFERENCES auth.users(id) ON DELETE RESTRICT bloke
-- sa net. Plizyè lòt tab (payment_proofs.uploaded_by, payments.reviewed_by,
-- disputes.author_id/resolved_by/assigned_to, refunds.reviewed_by) pa gen
-- ON DELETE ditou (= RESTRICT pa defo Postgres), menm bagay la. Kèk lòt tab
-- (disputes.customer_id, refunds.customer_id, reviews.customer_id CASCADE;
-- drivers.user_id CASCADE → deliveries.driver_id SET NULL an kaskad) ta
-- efase/pèdi istwa litij/ranbousman/avi/"kilès ki te livre" san lès si nou
-- ta jwenn yon fason pou kontounen RESTRICT la. Konklizyon: efasman "kont"
-- pa ka vle di DELETE literal pou okenn kliyan ki gen yon istwa reyèl.
--
-- Desizyon pwopriyetè konfime (KANPE EPI MANDE) :
--   1. Anonimizasyon, pa DELETE fizik — sèl apwòch ki mache san bloke pa
--      RESTRICT ki deja la a, e ki pa detwi istwa finansye/odit.
--   2. Pòte: kont KLIYAN sèlman (wòl 'customer', san okenn lòt wòl). Livrè/
--      restoran gen pwòp konsiderasyon (dokiman KYC, istwa payout) ki merite
--      yon tikè apa.
--   3. Deklanchman: zouti admin sèlman (dashboard.admin.users.tsx) — match
--      ak /privacy Sek 6 (NKD-022) ki deja pwomèt "yon pwosesis manyèl nou
--      fè apre demand ou [pa imèl/telefòn]", pa yon bouton self-service.
--   4. Done istorik nan ANSYEN kòmand/peman (orders.delivery_address/
--      contact_phone, payments.sender_name/sender_phone, order_chat_messages)
--      rete jan yo ye — rezon kontabilite/legal/rezoud litij pi fò pase
--      konfidansyalite retwoaktif, menm apwòch anpil platfòm itilize.
--
-- Sa RPC a anonimize: profiles (non/telefòn/adrès/foto), addresses (efase
-- kontni), favorites + push_subscriptions (efase liy yo antye, san
-- konsekans istorik), yon liy GPS ki ta rete (ra — GPS efase deja lè yon
-- livrezon fini, NKD-022 Sek 7). Kont lan bloke (ban 100 lane, menm
-- konvansyon ak suspendUserAccount) e imèl/metadata siyati a efase nan
-- auth.users pa yon apèl separe Admin API (manage-user.functions.ts te
-- deja etabli patrone sa a pou operasyon GoTrue) — pa dirèkteman nan SQL,
-- pou rezon ki menm jan an ak sa yo itilize deja nan pwojè a.
--
-- STRICT tier (TOTP oblije, pa gen fallback) — menm nivo ak chanjman wòl
-- (add/remove_user_role_secure), paske detwi PII se yon aksyon prèske
-- total irevèsib, menm gravite ak yon eskalasyon privilèj.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.anonymize_customer_secure(uuid, text);
--   DROP FUNCTION IF EXISTS public.get_all_users_admin(text, int, int, public.app_role);
--   -- Re-apply the immediately-prior CREATE of get_all_users_admin verbatim
--   -- (20260714121500_paginate_admin_lists.sql:24-88).
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS anonymized_at;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS anonymized_by;
--
-- Wrapped in BEGIN...COMMIT (A11) — DROP+CREATE on get_all_users_admin must
-- never leave a real window where the admin Users page's own query function
-- doesn't exist.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema. anonymized_by has no ON DELETE clause on purpose — same
--    "actor reference" convention already used throughout this schema
--    (payments.reviewed_by, disputes.resolved_by, etc.): it should simply
--    block deleting an admin who has anonymized someone, never cascade.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.profiles.anonymized_at IS
  'NKD-020: when an admin anonymized this account via anonymize_customer_secure(). NULL = never anonymized.';
COMMENT ON COLUMN public.profiles.anonymized_by IS
  'NKD-020: which admin performed the anonymization.';

-- ---------------------------------------------------------------------------
-- 2) anonymize_customer_secure — admin-only, customer-role-only, idempotency-
--    guarded. Scrubs public-schema PII; the caller (manage-user.functions.ts)
--    is responsible for the auth.users-side ban + email/metadata scrub via
--    the Admin API, in the same request.
CREATE OR REPLACE FUNCTION public.anonymize_customer_secure(_customer_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_admin, 'admin') OR public.has_role(v_admin, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_admin_step_up_strict();

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Kont kliyan an obligatwa.';
  END IF;
  IF _customer_id = v_admin THEN
    RAISE EXCEPTION 'Ou pa ka anonimize pwòp kont ou.';
  END IF;

  -- Scope guard (owner-confirmed): sèlman kont ki gen SÈLMAN wòl 'customer'.
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

  -- Defensive only: NKD-022 confirmed GPS rows already auto-delete when a
  -- delivery reaches a terminal status, so this should normally match zero
  -- rows — kept as a safety net for the rare still-active-delivery case.
  DELETE FROM public.customer_delivery_locations cdl
    USING public.deliveries d, public.orders o
    WHERE cdl.delivery_id = d.id AND d.order_id = o.id AND o.customer_id = _customer_id;

  PERFORM private.log_audit_event(v_admin, 'admin', 'customer_anonymized',
    jsonb_build_object('customer_id', _customer_id, 'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_customer_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_customer_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) get_all_users_admin — add anonymized_at so dashboard.admin.users.tsx
--    can show an "Anonimize" badge instead of the ban/role controls, and
--    hide the button once already done. Signature unchanged (still
--    text, int, int, public.app_role) but the RETURNS TABLE shape changes,
--    so per the documented lesson (20260709070000_fix_menu_overload_and_
--    commission_admin.sql), CREATE OR REPLACE alone is not enough here —
--    DROP FUNCTION first. Full body reproduced, diffed against the live
--    20260714121500_paginate_admin_lists.sql:24-88 version — unchanged
--    except the new column.
DROP FUNCTION IF EXISTS public.get_all_users_admin(text, int, int, public.app_role);
CREATE FUNCTION public.get_all_users_admin(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _role public.app_role DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  roles text[],
  banned_until timestamptz,
  anonymized_at timestamptz,
  total_count bigint
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
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.created_at,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]),
    u.banned_until,
    p.anonymized_at,
    count(*) OVER()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE (
    _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  )
  AND (
    _role IS NULL
    OR EXISTS (SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = p.id AND ur2.role = _role)
  )
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.created_at, u.banned_until, p.anonymized_at
  ORDER BY p.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260819100000', 'nkd020_customer_anonymization')
ON CONFLICT (version) DO NOTHING;

COMMIT;
