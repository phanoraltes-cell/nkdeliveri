-- PROMPT MODIFIKASYON — ekstansyon Tach 7 (demand itilizatè): kontra a dwe
-- gen DE TIP — youn pou restoran (deja egziste), youn pou LIVRÈ (nouvo).
--
-- ENVANTÈ KRITIK (dekouvri anvan ekri okenn SQL): `drivers.account_status`
-- DEJA gen 'pending_contract' nan CHECK li (migrasyon 20260821120000,
-- byen anvan pwomt 10-tach la), e `is_driver_eligible()` DEJA egzije
-- `account_status = 'active'` — kòmantè pwòp fonksyon an di literalman:
-- "'pending_contract'... ap vin siyifikatif nan pwochen etap chantye a SAN
-- CHANJMAN nan fonksyon sa a." Sa vle di ZEWO chanjman nesesè sou
-- is_driver_eligible()/claim_delivery_secure — yon livrè 'pending_contract'
-- DEJA ekskli otomatikman de tout livrezon, jodi a menm, san mwen pa touche
-- anyen la. Kontrèman ak restoran (Tach 7, ki te bezwen yon NOUVO valè
-- enum sou `status`), livrè yo itilize yon dimansyon SEPARE ki te DEJA
-- egziste: `account_status`, pa `status`. `status` (pending/approved/
-- suspended/rejected/online/offline) rete INTOUCHE.
--
-- Rezilta: pa gen okenn `ALTER TYPE ADD VALUE` nesesè pou livrè yo — tout
-- fichye sa a ka rete nan YON SÈL tranzaksyon.
--
-- Etand rezon: olye kreye yon dezyèm pè tab konplètman separe (yon
-- duplikasyon egzat), tab kontra Tach 7 yo (`restaurant_contract_versions`/
-- `restaurant_contract_signatures`) vin PATAJE ant de tip — yon kolòn
-- `contract_type` diskriminan sou vèsyon yo, ak `driver_id` (nouvo,
-- annil) bò kote `restaurant_id` (kounye a annil tou) sou siyati yo, ak
-- yon CHECK ki egzije EGZAKTEMAN youn nan de sib yo. Non tab yo chanje
-- (RENAME, pa DROP+CREATE — done Tach 7 ki deja egziste rete entak, tout
-- endèks/politik RLS/relasyon swiv otomatikman) pou reflete nouvo double
-- rezon yo.
--
-- SEKIRITE KRITIK dekouvri pandan analiz la: `drivers_self_update` (RLS)
-- kite yon livrè modifye NENPÒT kolòn nan pwòp liy li, san restriksyon —
-- se egzakteman poutèt sa `protect_driver_status_self_update` (trigger)
-- te kreye pou `status`. `account_status` PA T JANM gen menm pwoteksyon
-- an, paske li pa t janm itilize pou anyen ki gen konsekans reyèl jiska
-- kounye a (valè li te toujou 'active' pou tout moun). Kounye a ke
-- 'pending_contract' ap vin yon vrè eta operasyonèl, san pwoteksyon sa a
-- yon livrè ta ka kontoune siyati kontra a nèt: yon senp
-- `.from("drivers").update({account_status:"active"})` dirèk. Migrasyon
-- sa a fèmen twou sa a nan MENM fonksyon trigger a ki deja egziste (§4).
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Rename + jeneralize tab vèsyon kontra a. RENAME (pa DROP+CREATE)
--    prezève done Tach 7 ki deja egziste, endèks, ak politik RLS otomatikman.
ALTER TABLE public.restaurant_contract_versions RENAME TO contract_versions;

ALTER TABLE public.contract_versions
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'restaurant'
    CHECK (contract_type IN ('restaurant', 'driver'));

-- Ansyen kontrent UNIQUE(version) te fè nimewo vèsyon GLOBAL ant tou de
-- tip yo (premye kontra livrè a ta rele "vèsyon 4" si restoran an te deja
-- gen 3) — konfizan pou admin. UNIQUE(contract_type, version) kite chak
-- tip kòmanse a vèsyon 1 endepandamman.
ALTER TABLE public.contract_versions DROP CONSTRAINT IF EXISTS restaurant_contract_versions_version_key;
ALTER TABLE public.contract_versions
  ADD CONSTRAINT contract_versions_type_version_key UNIQUE (contract_type, version);

-- ---------------------------------------------------------------------------
-- 2) Rename + jeneralize tab siyati a. `restaurant_id` vin ANNIL (te
--    NOT NULL), `driver_id` nouvo (annil), CHECK egzije EGZAKTEMAN youn.
--    Done Tach 7 ki deja egziste satisfè CHECK la otomatikman (restaurant_id
--    deja ranpli, driver_id NULL pa default).
ALTER TABLE public.restaurant_contract_signatures RENAME TO contract_signatures;

ALTER TABLE public.contract_signatures
  ALTER COLUMN restaurant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE;

ALTER TABLE public.contract_signatures DROP CONSTRAINT IF EXISTS contract_signatures_one_target_check;
ALTER TABLE public.contract_signatures
  ADD CONSTRAINT contract_signatures_one_target_check
  CHECK (
    (restaurant_id IS NOT NULL AND driver_id IS NULL)
    OR (restaurant_id IS NULL AND driver_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_contract_signatures_driver ON public.contract_signatures(driver_id);
-- Menm patwon ak endèks inik pasyèl restaurant_id ki deja egziste (Tach 7)
-- — NULL pa antre an konfli ak NULL nan yon endèks inik Postgres, donk sa
-- a garanti pa gen 2 siyati AKTIF an menm tan pou menm LIVRÈ a, san afekte
-- kontrent restaurant_id ki deja la a.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_signatures_one_active_driver
  ON public.contract_signatures(driver_id) WHERE revoked_at IS NULL;

-- Politik lekti a mizajou pou enkli LIVRÈ ki gade PWÒP siyati pa yo a (te
-- sèlman kouvri pwopriyetè restoran anvan). Non politik la rete menm non
-- (pa te bezwen chanje akoz RENAME tab la, Postgres kenbe l otomatikman)
-- — DROP+CREATE isit la se paske KONTNI règ la chanje, pa akoz rename a.
DROP POLICY IF EXISTS "restaurant_contract_signatures_read" ON public.contract_signatures;
CREATE POLICY "contract_signatures_read" ON public.contract_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- ---------------------------------------------------------------------------
-- 3) get_current_contract_secure / create_contract_version_secure —
--    DROP+CREATE (nouvo paramèt `_contract_type` OBLIGATWA, pa DEFAULT —
--    yon default ta ka kite yon apèl mal chwazi kontra a san avèti pesonn,
--    pi bon fòse chak apèl deklare eksplisitman ki tip li vle a).
DROP FUNCTION IF EXISTS public.get_current_contract_secure();
CREATE FUNCTION public.get_current_contract_secure(_contract_type text)
RETURNS public.contract_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.contract_versions
  WHERE contract_type = _contract_type
  ORDER BY version DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_current_contract_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_contract_secure(text) TO authenticated;

DROP FUNCTION IF EXISTS public.create_contract_version_secure(text);
CREATE FUNCTION public.create_contract_version_secure(_content text, _contract_type text)
RETURNS public.contract_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contract_versions;
  v_next_version int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.create_contract_version_secure(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contract_version_secure(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) sign_restaurant_contract_secure / revoke_restaurant_contract_secure —
--    CREATE OR REPLACE sèlman (menm siyati, pa gen paramèt ki chanje) —
--    kò a mete ajou pou li tab renome yo + filtre `contract_type='restaurant'`.
CREATE OR REPLACE FUNCTION public.sign_restaurant_contract_secure(_restaurant_id uuid, _signature_name text)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants;
  v_contract public.contract_versions;
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

  SELECT * INTO v_contract FROM public.contract_versions
    WHERE contract_type = 'restaurant' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen kontra pibliye pou kounye a — kontakte sipò.';
  END IF;

  INSERT INTO public.contract_signatures (
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
-- 5) NOUVO — sign_driver_contract_secure / revoke_driver_contract_secure /
--    approve_driver_pending_contract_secure. Sib la se `account_status`
--    (PA `status`) — dimansyon konfòmite ki deja egziste, wè nòt anvan
--    BEGIN a. is_driver_eligible() deja gade sa a, ZEWO chanjman bò kote l.
CREATE OR REPLACE FUNCTION public.sign_driver_contract_secure(_driver_id uuid, _signature_name text)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers;
  v_contract public.contract_versions;
  v_row public.drivers;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE id = _driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF v_driver.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_driver.account_status <> 'pending_contract' THEN
    RAISE EXCEPTION 'Ou pa nan etap siyati kontra kounye a.';
  END IF;
  IF _signature_name IS NULL OR length(btrim(_signature_name)) = 0 THEN
    RAISE EXCEPTION 'Tanpri tape non konplè ou pou siyen.';
  END IF;

  SELECT * INTO v_contract FROM public.contract_versions
    WHERE contract_type = 'driver' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen kontra pibliye pou kounye a — kontakte sipò.';
  END IF;

  INSERT INTO public.contract_signatures (
    driver_id, contract_version_id, signed_by, signature_name
  ) VALUES (
    _driver_id, v_contract.id, auth.uid(), btrim(_signature_name)
  );

  -- account_status (pa status) — dimansyon konfòmite a, wè nòt migrasyon
  -- 20260821120000 (D1): "status" gade sik apwobasyon/prezans, li rete
  -- INTOUCHE isit la.
  UPDATE public.drivers SET account_status = 'active'
  WHERE id = _driver_id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(auth.uid(), 'driver', 'driver_contract.signed',
    jsonb_build_object('driver_id', _driver_id, 'contract_version', v_contract.version));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.sign_driver_contract_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_driver_contract_secure(uuid, text) TO authenticated;

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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.revoke_driver_contract_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_driver_contract_secure(uuid, text) TO authenticated;

-- "Apwouve" nan liy tann admin an (PendingDriversSection) rele SA A kounye
-- a olye update_driver_status_secure(id,'approved') dirèkteman — de chan
-- yo chanje ansanm (status + account_status), yon sèl aksyon atomik. Sa a
-- se yon RPC SEPARE, PA yon ekstansyon update_driver_status_secure a
-- espre: fonksyon jeneral sa a rele tou pou reyaktive/sispann yon livrè ki
-- DEJA apwouve/siyen — li pa ta dwe janm re-deklannche yon egzijans siyati
-- kontra pou yon livrè ki deja aktif.
CREATE OR REPLACE FUNCTION public.approve_driver_pending_contract_secure(_driver_id uuid)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.drivers;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
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
REVOKE ALL ON FUNCTION public.approve_driver_pending_contract_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_driver_pending_contract_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Sekirite — fèmen twou "drivers_self_update" pou account_status (wè
--    nòt kritik anvan BEGIN a). CREATE OR REPLACE sèlman, menm siyati —
--    blòk `status` ki deja egziste rete VÈBATIM, ajoute yon dezyèm blòk
--    apa pou `account_status`.
CREATE OR REPLACE FUNCTION private.protect_driver_status_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    IF OLD.status IN ('approved', 'online', 'offline') AND NEW.status IN ('online', 'offline') THEN
      IF NEW.status = 'online' AND NOT public.is_driver_eligible(NEW.id) THEN
        IF private.driver_ineligibility_reason(NEW.id) = 'permit_unknown_anomaly' THEN
          RAISE EXCEPTION 'Nou pa rive verifye pèmi ou. Kontakte sipò a oswa telechaje pèmi ou ankò.' USING ERRCODE = '42501';
        ELSE
          RAISE EXCEPTION 'Ou pa ka mete tèt ou anliy kounye a — verifye estati kont ou.' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Only an admin can change driver approval status' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- NOUVO — menm prensip pou account_status: sèl tranzisyon otoserv
  -- pèmèt se sign_driver_contract_secure a (pending_contract -> active).
  -- Tout lòt chanjman (menm yon lòt tranzisyon ki ta sanble san danje)
  -- mande yon admin — pa gen okenn ekstansyon "diskrè" akseptab isit la.
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
     AND NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    IF NOT (OLD.account_status = 'pending_contract' AND NEW.account_status = 'active') THEN
      RAISE EXCEPTION 'Only an admin can change driver account status' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) driver_ineligibility_reason — CREATE OR REPLACE, menm siyati, ajoute
--    yon branch eksplisit pou 'pending_contract' (te tonbe nan branch
--    jenerik 'account_status' anvan — mesaj pi presi kounye a pou
--    frontend ka gide livrè a dirèkteman bay siyati a, pa yon mesaj vag).
CREATE OR REPLACE FUNCTION private.driver_ineligibility_reason(_driver_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
BEGIN
  SELECT status, account_status, permit_expires_at, permit_grace_until INTO v_driver
    FROM public.drivers WHERE id = _driver_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_driver.status NOT IN ('approved', 'online', 'offline') THEN RETURN 'admin_status'; END IF;
  IF v_driver.account_status = 'suspended_admin' THEN RETURN 'admin_status'; END IF;
  IF v_driver.account_status = 'suspended_permit' THEN RETURN 'permit_expired'; END IF;
  IF v_driver.account_status = 'pending_contract' THEN RETURN 'pending_contract'; END IF;
  IF v_driver.account_status <> 'active' THEN RETURN 'account_status'; END IF;
  IF v_driver.permit_expires_at IS NOT NULL AND v_driver.permit_expires_at < CURRENT_DATE THEN
    RETURN 'permit_expired';
  END IF;
  IF v_driver.permit_expires_at IS NULL THEN
    IF v_driver.permit_grace_until IS NULL THEN RETURN 'permit_unknown_anomaly'; END IF;
    IF v_driver.permit_grace_until <= now() THEN RETURN 'permit_grace_expired'; END IF;
    RETURN 'permit_grace_period';
  END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION private.driver_ineligibility_reason(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260830130000', 'driver_contract_and_shared_contract_types')
ON CONFLICT (version) DO NOTHING;

COMMIT;
