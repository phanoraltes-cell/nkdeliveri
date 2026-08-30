-- PROMPT MODIFIKASYON (10 TACH) — Tach 7 (pati 2/2): flux siyati elektwonik
-- kontra restoran, ki bloke tranzisyon pending_contract → approved, ak
-- tèks kontra vèsyone + kapasite revoke pou admin.
--
-- FLUX KONPLE:
--   1) Admin apwouve yon aplikasyon restoran ('pending') → estati vin
--      'pending_contract' (chanjman FRONTEND sèlman, dashboard.admin.
--      index.tsx: bouton "Apwouve" a rele update_restaurant_status_secure
--      ak 'pending_contract' olye 'approved' dirèkteman — RPC sa a deja
--      aksepte NENPÒT valè restaurant_status, okenn chanjman SQL nesesè).
--   2) Pwopriyetè restoran an (SÈLMAN — pa anplwaye, pa admin) li dènye
--      vèsyon kontra a (get_current_contract_secure) epi siyen li
--      (sign_restaurant_contract_secure) — SÈL aksyon sa a chanje estati a
--      pou 'approved'. Se la Objektif "gating pending_contract→approved"
--      a reyèlman aplike.
--   3) Admin ka revoke yon siyati (revoke_restaurant_contract_secure) —
--      sa ranmennen restoran an 'pending_contract', ki OTOMATIKMAN fèmen
--      li bay kliyan (is_restaurant_open()/create_order_secure deja gate
--      sou status='approved' — ZEWO chanjman nesesè la, benefis gratis).
--
-- PA GEN BACKFILL: restoran ki DEJA 'approved' rete 'approved', san
-- siyati okenn kote — feature sa a aplike sèlman pou apwobasyon FITI yo.
-- Fòse tout restoran aktif yo re-siyen retwoaktivman ta yon dezizyon
-- biznis/legal, pa yon efè segondè migrasyon — si sa nesesè, admin ka
-- itilize revoke_restaurant_contract_secure manyèlman sou yon restoran
-- espesifik pi ta, kaz pa kaz.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l). Depann de Pati 1
-- (20260829220000) — dwe deja komite anvan fichye sa a.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) restaurant_contract_versions — istwa kontra a, APPEND-ONLY (yon
--    vèsyon deja pibliye pa janm modifye — yon chanjman tèks se yon NOUVO
--    vèsyon). "Vèsyon aktyèl la" = pi gwo `version` la, pa yon flag
--    modifyab (sa ta ka gen 2 "aktyèl" si yon moun bliye retire ansyen an).
CREATE TABLE IF NOT EXISTS public.restaurant_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  content text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_contract_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.restaurant_contract_versions TO authenticated;
GRANT ALL ON public.restaurant_contract_versions TO service_role;
DROP POLICY IF EXISTS "restaurant_contract_versions_read" ON public.restaurant_contract_versions;
CREATE POLICY "restaurant_contract_versions_read" ON public.restaurant_contract_versions FOR SELECT TO authenticated
  USING (true);
-- Pa gen INSERT/UPDATE/DELETE dirèk — sèlman create_contract_version_secure.

-- ---------------------------------------------------------------------------
-- 2) restaurant_contract_signatures — istwa siyati pa restoran (plizyè
--    ranje posib si yon siyati revoke epi restoran an resiyen apre). Yon
--    endèks inik PASYÈL garanti pa gen JANM 2 siyati AKTIF (revoked_at
--    IS NULL) an menm tan pou menm restoran.
CREATE TABLE IF NOT EXISTS public.restaurant_contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  contract_version_id uuid NOT NULL REFERENCES public.restaurant_contract_versions(id),
  signed_by uuid NOT NULL REFERENCES auth.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  -- Non konplè pwopriyetè a tape pou siyen (konvansyon e-siyati "tape non
  -- ou" — pa yon siyati grafik/kanvas, ki ta mande yon zouti diferan).
  signature_name text NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS idx_restaurant_contract_signatures_restaurant
  ON public.restaurant_contract_signatures(restaurant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_contract_signatures_one_active
  ON public.restaurant_contract_signatures(restaurant_id) WHERE revoked_at IS NULL;

ALTER TABLE public.restaurant_contract_signatures ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.restaurant_contract_signatures TO authenticated;
GRANT ALL ON public.restaurant_contract_signatures TO service_role;
DROP POLICY IF EXISTS "restaurant_contract_signatures_read" ON public.restaurant_contract_signatures;
CREATE POLICY "restaurant_contract_signatures_read" ON public.restaurant_contract_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );
-- Pa gen INSERT/UPDATE/DELETE dirèk — sèlman sign_/revoke_
-- restaurant_contract_secure.

-- ---------------------------------------------------------------------------
-- 3) get_current_contract_secure — dènye vèsyon pibliye a. 0 ranje si
--    admin poko janm pibliye youn (fòm siyati a montre yon eta "poko
--    disponib" nan ka sa a, pa yon erè).
CREATE OR REPLACE FUNCTION public.get_current_contract_secure()
RETURNS public.restaurant_contract_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.restaurant_contract_versions ORDER BY version DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_current_contract_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_contract_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) create_contract_version_secure — admin sèlman, ekri yon nouvo
--    vèsyon (jamè modifye youn ki deja egziste).
CREATE OR REPLACE FUNCTION public.create_contract_version_secure(_content text)
RETURNS public.restaurant_contract_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.restaurant_contract_versions;
  v_next_version int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _content IS NULL OR length(btrim(_content)) = 0 THEN
    RAISE EXCEPTION 'Tèks kontra a obligatwa.';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version FROM public.restaurant_contract_versions;

  INSERT INTO public.restaurant_contract_versions (version, content, created_by)
  VALUES (v_next_version, _content, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_contract_version_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contract_version_secure(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) sign_restaurant_contract_secure — SÈL chemen ki fè
--    pending_contract → approved. Pwopriyetè SÈLMAN (owner_id = auth.uid(),
--    pa is_restaurant_manager — admin/anplwaye pa ka siyen yon kontra pou
--    non biznis la, sa se yon dwa legal pwopriyetè a sèlman).
CREATE OR REPLACE FUNCTION public.sign_restaurant_contract_secure(_restaurant_id uuid, _signature_name text)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants;
  v_contract public.restaurant_contract_versions;
  v_row public.restaurants;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF v_restaurant.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_restaurant.status <> 'pending_contract' THEN
    RAISE EXCEPTION 'Restoran sa a pa nan etap siyati kontra kounye a.';
  END IF;
  IF _signature_name IS NULL OR length(btrim(_signature_name)) = 0 THEN
    RAISE EXCEPTION 'Tanpri tape non konplè ou pou siyen.';
  END IF;

  SELECT * INTO v_contract FROM public.restaurant_contract_versions ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen kontra pibliye pou kounye a — kontakte sipò.';
  END IF;

  INSERT INTO public.restaurant_contract_signatures (
    restaurant_id, contract_version_id, signed_by, signature_name
  ) VALUES (
    _restaurant_id, v_contract.id, auth.uid(), btrim(_signature_name)
  );

  UPDATE public.restaurants SET status = 'approved'
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(auth.uid(), 'restaurant', 'restaurant_contract.signed',
    jsonb_build_object('restaurant_id', _restaurant_id, 'contract_version', v_contract.version));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.sign_restaurant_contract_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_restaurant_contract_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) revoke_restaurant_contract_secure — admin sèlman. Mande yon siyati
--    AKTIF egziste (si restoran an pa janm siyen, sèvi ak
--    update_restaurant_status_secure dirèkteman pou chanje estati a olye).
--    Retounen estoran an 'pending_contract' — is_restaurant_open()/
--    create_order_secure deja rejte tout kòmand pou yon restoran ki pa
--    'approved', donk restoran an fèmen imedyatman bay kliyan san okenn
--    lòt chanjman.
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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_signature_id FROM public.restaurant_contract_signatures
    WHERE restaurant_id = _restaurant_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restoran sa a pa gen okenn siyati aktif pou revoke.';
  END IF;

  UPDATE public.restaurant_contract_signatures
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
REVOKE ALL ON FUNCTION public.revoke_restaurant_contract_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_restaurant_contract_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829220500', 'restaurant_contract_esignature')
ON CONFLICT (version) DO NOTHING;

COMMIT;
