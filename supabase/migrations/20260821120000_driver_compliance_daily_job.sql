-- Chantier livreurs/restoran — Point 6: konfòmite pèmi livrè + job kotidyen.
--
-- Sa a bati sou 3 desizyon deja konfime ak pwopriyetè a nan menm chantye a:
--
--   D1 — `account_status` se yon kolòn ORTOGONAL de `drivers.status`.
--   `status` gade sik apwobasyon/prezans (pending/approved/suspended/
--   rejected/online/offline, chanje pa AUCUN kòd nan migrasyon sa a).
--   `account_status` gade konfòmite (jodi a: sèlman pèmi; 'pending_contract'
--   ak 'suspended_admin' rete nan CHECK la pou pita, Seksyon 1.3/2, men
--   AUCUN kòd isit la pa janm ekri yo). `is_driver_eligible()` se SÈL
--   otorite ki konbine tou de dimansyon yo — jamè yon lòt kote reyekri
--   règ la pa li menm.
--
--   Presedans: yon sispansyon admin (`status = 'suspended'` oswa
--   'rejected') toujou genyen sou `account_status = 'active'`.
--
--   D6/D9 — menm pandan ak `is_restaurant_open()`: `permit_expires_at`
--   rete NULLABLE nan SQL (yon `NOT NULL` ta fè `ALTER TABLE` echwe sou
--   done ki egziste deja); karaktè obligatwa a aplike nan fòm + nan RPC
--   kreyasyon/renouvèlman (pwochen migrasyon, poko ekri) — pa isit la.
--
--   Migrasyon done ki egziste deja: menm mekanis EGZAK ak
--   `opening_hours_grace_until` (20260821100000) — trigger ki kenbe yon
--   fenèt gras otomatikman + yon backfill separe pou liy ki deja egziste,
--   menm 30-jou (pa 14) pou menm rezon: fòm telechajman pèmi a poko
--   egziste (Seksyon 1 frontend), donk okenn livrè pa ta ka ranpli
--   `permit_expires_at` anvan yon delè kout ekspire.
--
-- REVISION (dezyèm revizyon pwopriyetè a, kritik):
--   1) `delivery_proof` (20260821090000) bezwen yon règ retansyon: 90 jou,
--      nan job sa a.
--   2) Rapèl ki deklannche yon NOTIFIKASYON dwe kouri a 8è maten lokal, PA
--      ansanm ak balayaj san bri yo a 4è — yon push a 4-5è maten sabotaj
--      pwòp objektif Seksyon 6 la (notifikasyon obligatwa: moun ap koupe
--      yo). Balayaj san bri yo (sispansyon, pij, netwayaj) rete 4è, san
--      pwoblèm, pesonn pa wè yo.
--   3) `BEGIN...EXCEPTION` pa bay izolasyon reyèl si tout job la se YON SÈL
--      fonksyon apèle pa pg_cron: tout rezilta yo (menm audit_log ki reyisi
--      yo) rete andedan yon SÈL transaksyon jiskaske fonksyon an FINI —
--      si pwosesis la kraze/blije nan mitan, TOUT bagay anile, menm sa ki
--      te reyisi. Solisyon: **chak tach gen pwòp antre pg_cron pa li**,
--      pg_cron egzekite chak nan pwòp transaksyon endepandan. Fonksyon
--      orchestrator la (`run_daily_compliance_secure`) rete, men SÈLMAN
--      pou relans manyèl/debug — se pa li pg_cron rele.
--   4) Yon tach `compliance-heartbeat` ajoute — san li, yon kwontab ki mouri
--      an silans sanble egzakteman ak yon kwontab ki pa jwenn anyen pou fè.
--
-- REVISION #3 (twazyèm revizyon pwopriyetè a):
--   Kesyon poze: konbyen livrè `approved`/`online` ta pase `suspended_permit`
--   nan premye kouri balayaj la? **Repons: ZEWO**, e rezon an enpòtan pou
--   konprann — de mekanis SEPARE ki fasil pou konfonn:
--     - `is_driver_eligible()`/`permit_grace_until` gouvène ELIJIBLITE AN
--       LEKTI (èske yon livrè ka rete online/pran yon kòmand kounye a).
--       Backfill la (§2) garanti chak livrè jwenn yon fenèt gras 30 jou
--       imedyatman — pesonn pa pèdi elijiblite jou migrasyon an aplike.
--     - `run_permit_suspension_sweep()` se yon mekanis DIFERAN: li sèlman
--       aji sou `permit_expires_at IS NOT NULL AND ... < CURRENT_DATE` —
--       yon VRÈ dat depase. Piske `permit_expires_at` rete NULL pou 100%
--       pak la jiskaske fòm renouvèlman an (poko ekri) ranpli l, balayaj
--       la STRIKTIMAN pa ka jwenn okenn kandida nan eta done aktyèl la.
--   Sa a KONFIME pa done, pa pa sipozisyon — men règ pwojè a rete: pa fè
--   konfyans a yon rezònman, ajoute yon FILÈ MEKANIK ki mezire li menm
--   chak fwa (§7, `_force` parametr) — si yon lòt chanjman nan lavni ta
--   janm fè yon gwo pousantaj pak la vin kandida menm jou a, pou nenpòt
--   rezon (yon erè nan yon RPC renouvèlman pa ekri ankò, pa egzanp),
--   balayaj la kanpe li menm olye pou l aji san sipèvizyon.
--
--   Ajoute an menm tan: (a) yon mesaj DIFERAN pou yon livrè bloke pa yon
--   anomali (`permit_grace_until` NULL — pa ta dwe rive, backfill anpeche
--   l) kont yon livrè ak yon vrè pèmi ekspire — li pa dwe wè menm tèks la
--   pou de sitiyasyon totalman diferan; (b) `detect_compliance_grace_
--   anomalies()` kounye a kouri chak 15 minit (§10) olye chak jou, ak yon
--   frenaj notifikasyon (pa plis pase 1 fwa pa è pou menm anomali a ki
--   rete la) — pa vrèman "imedya" (yon RAISE EXCEPTION anile nenpòt
--   notifikasyon ki t ap ekri nan menm apèl la, yon vrè kontrent
--   transaksyonèl, pa yon chwa), men bòne a 15 minit olye 24è; (c)
--   `compliance-permit-suspension` RETIRE nan planifikasyon §10 pou
--   kounye a — pa dwe planifye jiskaske chemen renouvèlman an (fòm +
--   RPC, poko ekri) egziste, otreman yo ta sispann livrè ki pa gen okenn
--   fason pou remèt tèt yo an règ.
--
-- ⚠️ DERIV LÈ SEZON (pa nye l): Ayiti aplike VRÈMAN chanjman lè (EST
-- UTC-5 an ivè, EDT UTC-4 an ete, dezyèm dimanch mas jiska premye dimanch
-- novanm). Jodi a (21 out 2026) nou nan EDT (UTC-4). Ekspresyon cron pi ba
-- yo kalkile pou EDT KOUNYE A — yo ap glise ~1è de fwa pa ane (jiskaske
-- 1ye novanm 2026, epi ankò mas 2027) SI `cron.timezone` pa configire ak
-- 'America/Port-au-Prince'. Verifye ak `SHOW cron.timezone;` anvan
-- aplikasyon — si li di UTC, swa (a) chanje l globalman
-- (`ALTER SYSTEM SET cron.timezone = 'America/Port-au-Prince';`, mande
-- Supabase Support si sa pa aksesib dirèkteman sou pwojè a), swa (b) mete
-- yon rapèl pou ajiste ekspresyon yo 2 fwa pa ane. Pou tach sa yo
-- (balayaj/pij/rapèl), yon glisman 1è pa gen okenn konsekans grav — men pa
-- ekri sa an kòmantè kòm "pa gen deriv", se fo.
--
-- ⚠️ Pou revize dirèkteman, pa dedwi: chak SQL kritik nan chantye sa a se
-- kole vèbatim, pa rezime.
--
-- ⚠️ DEPANDANS APLIKASYON — migrasyon sa a DWE aplike APRE de sa yo (menm
-- chantye a):
--   - 20260821090000 (fix_delivery_location_retention_leak) — tab
--     `delivery_proof` (§7 sweep_abandoned_delivery_locations,
--     purge_delivery_proof) dwe egziste deja.
--   - 20260821100000 (restaurant_open_check_order_creation) — kolòn
--     `opening_hours_grace_until` (§7 detect_compliance_grace_anomalies,
--     send_compliance_reminders) dwe egziste deja.
-- Si w aplike sa a anvan, ALTER TABLE / referans yo ap echwe touswit ak
-- yon erè "column/relation does not exist" — pa yon echèk silansye.
--
-- ROLLBACK:
--   -- 'compliance-permit-suspension' PA nan lis la: li pa planifye pa
--   -- migrasyon sa a (Revizyon #3, point 4) — anyen pou pa fè.
--   SELECT cron.unschedule('compliance-cron-purge');
--   SELECT cron.unschedule('compliance-location-sweep');
--   SELECT cron.unschedule('compliance-delivery-proof-purge');
--   SELECT cron.unschedule('compliance-anomaly-check');
--   SELECT cron.unschedule('compliance-heartbeat');
--   SELECT cron.unschedule('compliance-reminders');
--   DROP FUNCTION IF EXISTS private.run_daily_compliance_secure();
--   DROP FUNCTION IF EXISTS private.send_compliance_reminders();
--   DROP FUNCTION IF EXISTS private.run_compliance_heartbeat();
--   DROP FUNCTION IF EXISTS private.detect_compliance_grace_anomalies();
--   DROP FUNCTION IF EXISTS private.purge_delivery_proof();
--   DROP FUNCTION IF EXISTS private.sweep_abandoned_delivery_locations();
--   DROP FUNCTION IF EXISTS private.purge_cron_job_run_details();
--   DROP FUNCTION IF EXISTS private.run_permit_suspension_sweep(boolean);
--   DROP FUNCTION IF EXISTS private.delivery_proof_retention_period();
--   DROP FUNCTION IF EXISTS public.report_permit_anomaly_secure();
--   DROP FUNCTION IF EXISTS private.driver_ineligibility_reason(uuid);
--   DROP FUNCTION IF EXISTS public.is_driver_eligible(uuid);
--   DROP TRIGGER IF EXISTS trg_maintain_driver_permit_grace ON public.drivers;
--   DROP FUNCTION IF EXISTS private.maintain_driver_permit_grace();
--   DROP FUNCTION IF EXISTS private.driver_permit_grace_period();
--   -- Re-aplike kò `private.claim_delivery_secure` orijinal la verbatim,
--   -- soti nan 20260813140000_translate_claim_delivery_messages.sql.
--   -- Re-aplike kò `private.protect_driver_status_self_update` orijinal
--   -- la verbatim, soti nan 20260704180000_c2c3d48b...sql:14-29.
--   ALTER TABLE public.restaurants
--     DROP COLUMN IF EXISTS last_hours_reminder_stage,
--     DROP COLUMN IF EXISTS last_hours_reminder_sent_at;
--   ALTER TABLE public.drivers
--     DROP COLUMN IF EXISTS permit_expires_at,
--     DROP COLUMN IF EXISTS permit_status,
--     DROP COLUMN IF EXISTS account_status,
--     DROP COLUMN IF EXISTS suspended_reason,
--     DROP COLUMN IF EXISTS suspended_at,
--     DROP COLUMN IF EXISTS permit_grace_until,
--     DROP COLUMN IF EXISTS last_permit_reminder_stage,
--     DROP COLUMN IF EXISTS last_permit_reminder_sent_at;
--
-- Wrapped BEGIN...COMMIT (A11).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Kolòn konfòmite pèmi sou drivers. `license_doc_url` ki deja egziste
--    kontinye sèvi kòm foto pèmi a (deja lebel "Pèmi" nan fòm enskripsyon
--    an) — pa gen nouvo kolòn URL/chemen nesesè, sèlman dat ekspirasyon +
--    estati.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS permit_expires_at date,
  ADD COLUMN IF NOT EXISTS permit_status text NOT NULL DEFAULT 'valid'
    CHECK (permit_status IN ('valid', 'expiring_soon', 'expired')),
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending_contract', 'pending_review', 'active', 'suspended_permit', 'suspended_admin', 'rejected')),
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS permit_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_permit_reminder_stage int,
  ADD COLUMN IF NOT EXISTS last_permit_reminder_sent_at timestamptz;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS last_hours_reminder_stage int,
  ADD COLUMN IF NOT EXISTS last_hours_reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Konstant nomme + trigger + backfill — menm mekanis EGZAK ak
--    opening_hours_grace_until (20260821100000 §0-1), aplike a pèmi livrè.
CREATE OR REPLACE FUNCTION private.driver_permit_grace_period()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '30 days' $$;

CREATE OR REPLACE FUNCTION private.maintain_driver_permit_grace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.permit_expires_at IS NULL THEN
    IF NEW.permit_grace_until IS NULL THEN
      NEW.permit_grace_until := now() + private.driver_permit_grace_period();
    END IF;
  ELSE
    NEW.permit_grace_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_driver_permit_grace ON public.drivers;
CREATE TRIGGER trg_maintain_driver_permit_grace
BEFORE INSERT OR UPDATE OF permit_expires_at ON public.drivers
FOR EACH ROW EXECUTE FUNCTION private.maintain_driver_permit_grace();

-- `status IN (...)`: pa chanje okenn rezilta elijiblite (yon livrè pending/
-- suspended/rejected deja bloke pa premye chèk is_driver_eligible() a,
-- kèlkeswa permit_grace_until) — men evite mete yon fenèt gras san sans
-- sou yon liy ki deja fèmen pou yon lòt rezon, pou done a rete pwòp.
UPDATE public.drivers
SET permit_grace_until = now() + private.driver_permit_grace_period()
WHERE permit_expires_at IS NULL
  AND permit_grace_until IS NULL
  AND status IN ('approved', 'online', 'offline');

-- ---------------------------------------------------------------------------
-- 3) is_driver_eligible() — sèl otorite. Kontrèman ak is_restaurant_open()
--    (filè sekirite = LOUVRI pa default), filè sekirite ISIT LA se
--    ELIJIB=FALSE pa default: yon anwomali (backfill ki ta rate yon liy)
--    gen enpak pi grav isit la (yon livrè k ap travay san estati konfòmite
--    klè) pase pou yon restoran ki parèt fèmen pa erè. detect_compliance_
--    grace_anomalies() (§8) siveye ka sa a chak jou.
--
--    Verifikasyon pèmi a fèt AN DIRÈK sou permit_expires_at (pa sèlman
--    fè konfyans a account_status) — se egzijans eksplisit pwopriyetè a:
--    "même si le cron échoue, un permis expiré ne peut pas recevoir de
--    commande". Yon pèmi ekspire vle di pa elijib touswit, kwit kwontab
--    la poko gen tan pase pou mete account_status ajou.
CREATE OR REPLACE FUNCTION public.is_driver_eligible(_driver_id uuid)
RETURNS boolean
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
  IF NOT FOUND THEN RETURN false; END IF;

  -- Presedans: yon sispansyon/rejè admin (dimansyon `status`) toujou genyen.
  IF v_driver.status NOT IN ('approved', 'online', 'offline') THEN RETURN false; END IF;

  -- Dimansyon konfòmite (account_status) — 'suspended_permit' isit la
  -- jodi a; 'pending_contract'/'suspended_admin' ap vin siyifikatif nan
  -- pwochen etap chantye a san chanjman nan fonksyon sa a.
  IF v_driver.account_status <> 'active' THEN RETURN false; END IF;

  -- Chèk pèmi an DIRÈK, pa konte sou kwontab la fin pase.
  IF v_driver.permit_expires_at IS NOT NULL AND v_driver.permit_expires_at < CURRENT_DATE THEN
    RETURN false;
  END IF;
  IF v_driver.permit_expires_at IS NULL THEN
    RETURN v_driver.permit_grace_until IS NOT NULL AND v_driver.permit_grace_until > now();
  END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.is_driver_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver_eligible(uuid) TO authenticated;

-- Sibling ki EKSPLIKE poukisa (pa ki DESIDE) — pa yon dezyèm otorite: chak
-- branch li a re-itilize menm chan yo is_driver_eligible() li, jamè li pa
-- envante yon nouvo règ. Pòte pi laj pase jis "ki bloke m": rezilta
-- 'permit_grace_period' la dekri yon livrè ki ELIJIB (is_driver_eligible()
-- ta retounen true) men k ap travay sou yon fenèt gras tanporè — itil pou
-- yon bannyè "antre dat ekspirasyon w" nan tablodbò livrè a (Seksyon 1
-- frontend, poko ekri) san atann yo vin bloke anvan yo wè yon mesaj.
-- Rezon li egziste apa de is_driver_eligible(): distenge yon anomali entèn
-- ('permit_unknown_anomaly' — permit_expires_at vid E permit_grace_until
-- vid, ka ki backfill la ta dwe anpeche) de yon vrè rejè (pèmi vre ekspire,
-- sispansyon admin) — moun nan pa dwe wè menm mesaj la pou de sitiyasyon
-- ki mande de aksyon konplètman diferan.
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
  IF v_driver.account_status <> 'active' THEN RETURN 'account_status'; END IF;
  IF v_driver.permit_expires_at IS NOT NULL AND v_driver.permit_expires_at < CURRENT_DATE THEN
    RETURN 'permit_expired';
  END IF;
  IF v_driver.permit_expires_at IS NULL THEN
    IF v_driver.permit_grace_until IS NULL THEN RETURN 'permit_unknown_anomaly'; END IF;
    IF v_driver.permit_grace_until <= now() THEN RETURN 'permit_grace_expired'; END IF;
    -- Elijib (fenèt gras aktif), men ta dwe regilarize — pa yon rejè.
    RETURN 'permit_grace_period';
  END IF;
  RETURN 'ok';
END;
$$;
-- Pa gen GRANT eksplisit — apèl SÈLMAN nan lòt fonksyon SECURITY DEFINER
-- (claim_delivery_secure, protect_driver_status_self_update pi ba a), ki
-- egzekite ak dwa OWNER a kèlkeswa kiyès ki rele yo, menm jan ak private.
-- notify_secure/log_audit_event deja etabli nan pwojè a.
REVOKE ALL ON FUNCTION private.driver_ineligibility_reason(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) claim_delivery_secure — CREATE OR REPLACE, menm siyati, ajoute chèk
--    elijiblite apre chèk 'online' ki deja egziste a. Rès kò a idantik
--    verbatim ak vèsyon aktyèl la (20260813140000).
CREATE OR REPLACE FUNCTION private.claim_delivery_secure(_order_id uuid)
RETURNS deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.drivers;
  v_order public.orders;
  v_row public.deliveries;
BEGIN
  IF NOT public.check_rate_limit_secure('claim_delivery', 20, 300) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sèlman yon kont livrè ka pran yon livrezon';
  END IF;
  IF v_driver.status <> 'online' THEN
    RAISE EXCEPTION 'Ou dwe an liy pou ka pran yon livrezon';
  END IF;
  IF NOT public.is_driver_eligible(v_driver.id) THEN
    IF private.driver_ineligibility_reason(v_driver.id) = 'permit_unknown_anomaly' THEN
      RAISE EXCEPTION 'Nou pa rive verifye pèmi ou. Kontakte sipò a oswa telechaje pèmi ou ankò.';
    ELSE
      RAISE EXCEPTION 'Ou pa ka pran yon livrezon kounye a — verifye estati kont ou.';
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nou pa jwenn kòmand sa a';
  END IF;
  IF v_order.status <> 'ready' THEN
    RAISE EXCEPTION 'Kòmand sa a pa disponib ankò — gen dwa yon lòt livrè deja pran l, oswa estati li chanje.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = _order_id) THEN
    RAISE EXCEPTION 'Kòmand sa a deja pran pa yon lòt livrè';
  END IF;

  INSERT INTO public.deliveries (order_id, driver_id, status, fee)
  VALUES (_order_id, v_driver.id, 'assigned', COALESCE(v_order.delivery_fee, 0))
  RETURNING * INTO v_row;

  UPDATE public.orders SET
    status = 'assigned',
    status_history = status_history || jsonb_build_object(
      'from', v_order.status, 'to', 'assigned', 'by', auth.uid(), 'at', now()
    ),
    updated_at = now()
  WHERE id = _order_id;

  RETURN v_row;
END;
$function$;

-- 4b) report_permit_anomaly_secure — apèl SEPARE (pa nan menm transaksyon
--     ak claim_delivery_secure/toggle a) pou fwontend lan ka rele imedyatman
--     lè li resevwa rezon 'permit_unknown_anomaly' la. Yon RAISE EXCEPTION
--     nan yon apèl BLOKE pa ka notifye AK bloke nan menm transaksyon an
--     (§7 balayaj 15-minit gen menm limit la) — yon dezyèm apèl RPC apa,
--     pwòp transaksyon pa li, se sèl fason pou notifikasyon an SIVIV e rive
--     "imedyatman" olye tann pwochen balayaj 15-minit la. Reverifye anomali
--     a SÈVÈ-SIDE anvan li notifye (pa fè konfyans a sa kliyan an di).
CREATE OR REPLACE FUNCTION public.report_permit_anomaly_secure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  IF NOT public.check_rate_limit_secure('report_permit_anomaly', 3, 3600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sèlman yon kont livrè ka rapòte sa a';
  END IF;

  IF private.driver_ineligibility_reason(v_driver_id) <> 'permit_unknown_anomaly' THEN
    RETURN; -- pa gen okenn anomali reyèl pou kont sa a — pa kreye fo alèt
  END IF;

  PERFORM private.notify_secure(
    ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
    'driver_permit_anomaly_reported', 'admin',
    'Livrè rapòte yon pwoblèm pèmi',
    'Yon livrè rapòte li pa ka verifye pèmi li — verifye kont li.',
    jsonb_build_object('driver_id', v_driver_id)
  );
  PERFORM private.log_audit_event(auth.uid(), 'driver', 'compliance.permit_anomaly_reported',
    jsonb_build_object('driver_id', v_driver_id));
END;
$$;
REVOKE ALL ON FUNCTION public.report_permit_anomaly_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_permit_anomaly_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) protect_driver_status_self_update — CREATE OR REPLACE, menm siyati,
--    bloke pasaj oto-sèvis a 'online' si livrè a pa elijib. Rès kò a
--    idantik verbatim ak vèsyon aktyèl la (20260704180000).
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
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Retansyon delivery_proof — konstant nomme, 90 jou (validé pa
--    pwopriyetè a — "assez long pour couvrir la fenêtre réaliste de
--    contestation, assez court pour ne pas accumuler un historique de
--    géolocalisation indéfiniment").
CREATE OR REPLACE FUNCTION private.delivery_proof_retention_period()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '90 days' $$;

-- ---------------------------------------------------------------------------
-- 7) Sèt (7) fonksyon endepandan, chak yon sèl responsabilite, chak
--    relansab manyèlman. pg_cron rele CHAK youn dirèkteman nan pwòp antre
--    li (§10) — se sa ki bay izolasyon reyèl (Revizyon #3).

-- `_force` — rezève pou yon apèl manyèl admin lè yon sispansyon an mas
-- reyèlman jistifye. Pa janm rele pa pg_cron (§10) — kwontab la toujou
-- itilize default false.
CREATE OR REPLACE FUNCTION private.run_permit_suspension_sweep(_force boolean DEFAULT false)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_candidate_count int;
  v_active_population int;
  v_threshold int;
  v_ids uuid[];
  v_row record;
BEGIN
  SELECT count(*) INTO v_candidate_count FROM public.drivers
    WHERE account_status = 'active' AND permit_expires_at IS NOT NULL AND permit_expires_at < CURRENT_DATE;

  IF v_candidate_count = 0 THEN
    RETURN 0;
  END IF;

  -- Koupsikwi mas: si plis pase 20% pak aktif la (oswa 10 livrè, sa ki pi
  -- gran) ta sispann nan yon sèl kouri, sa pa sanble ak "plizyè pèmi vre
  -- ekspire menm jou a" — sa sanble ak yon bug oswa yon migrasyon ki mal
  -- pase. Kanpe san ekri anyen, reklame yon imen.
  SELECT count(*) INTO v_active_population FROM public.drivers WHERE account_status = 'active';
  v_threshold := GREATEST(10, CEIL(v_active_population * 0.2));

  IF v_candidate_count > v_threshold AND NOT _force THEN
    SELECT array_agg(id) INTO v_ids FROM public.drivers
      WHERE account_status = 'active' AND permit_expires_at IS NOT NULL AND permit_expires_at < CURRENT_DATE;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.permit_sweep_aborted_threshold',
      jsonb_build_object('candidate_count', v_candidate_count, 'threshold', v_threshold, 'driver_ids', to_jsonb(v_ids)));
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'permit_sweep_aborted', 'admin',
      'Balayaj sispansyon pèmi kanpe — twòp livrè',
      v_candidate_count || ' livrè te pral sispann nan yon sèl kou (limit: ' || v_threshold
        || '). Anyen pa aplike — verifye done yo anvan ou fòse balayaj la manyèlman.',
      jsonb_build_object('candidate_count', v_candidate_count, 'threshold', v_threshold)
    );
    RETURN -1; -- sentinèl: balayaj la kanpe, se pa yon vrè konte
  END IF;

  FOR v_row IN
    SELECT id, user_id, permit_expires_at
    FROM public.drivers
    WHERE account_status = 'active'
      AND permit_expires_at IS NOT NULL
      AND permit_expires_at < CURRENT_DATE
    FOR UPDATE
  LOOP
    UPDATE public.drivers SET
      account_status = 'suspended_permit',
      status = CASE WHEN status = 'online' THEN 'offline'::public.driver_status ELSE status END,
      permit_status = 'expired',
      suspended_reason = 'Pèmi ekspire depi ' || to_char(v_row.permit_expires_at, 'DD/MM/YYYY') || '.',
      suspended_at = now()
    WHERE id = v_row.id;

    PERFORM private.notify_secure(
      ARRAY[v_row.user_id], 'permit_expired', 'system',
      'Pèmi ou ekspire',
      'Pèmi ou ekspire depi ' || to_char(v_row.permit_expires_at, 'DD/MM/YYYY')
        || '. Ou pa ka resevwa nouvo kòmand jiskaske ou telechaje yon nouvo pèmi. Kòmand anko a ap kontinye san pwoblèm.',
      jsonb_build_object('driver_id', v_row.id)
    );
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'driver_permit_expired', 'admin',
      'Pèmi yon livrè ekspire',
      'Yon livrè sispann otomatikman paske pèmi li ekspire.',
      jsonb_build_object('driver_id', v_row.id)
    );

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_cron_job_run_details()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.sweep_abandoned_delivery_locations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Kaptire prèv anvan efase — menm rezon ak trigger pwoteksyon-livrezon an
  -- (20260821090000), men isit la pou livrezon ki JAMÈ rive nan yon eta
  -- terminal (livrè disparèt, delivery pa janm femen) donk trigger sa a pa
  -- janm deklannche pou yo.
  INSERT INTO public.delivery_proof (delivery_id, final_driver_lat, final_driver_lng, final_location_at, final_status)
  SELECT id, driver_lat, driver_lng, location_updated_at, 'abandoned_retention_sweep'
  FROM public.deliveries
  WHERE status NOT IN ('delivered', 'cancelled', 'delivery_failed')
    AND location_updated_at IS NOT NULL
    AND location_updated_at < now() - interval '24 hours'
  ON CONFLICT (delivery_id) DO UPDATE SET
    final_driver_lat = EXCLUDED.final_driver_lat,
    final_driver_lng = EXCLUDED.final_driver_lng,
    final_location_at = EXCLUDED.final_location_at,
    final_status = EXCLUDED.final_status;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.deliveries
  SET driver_lat = NULL, driver_lng = NULL, driver_heading = NULL, location_updated_at = NULL
  WHERE status NOT IN ('delivered', 'cancelled', 'delivery_failed')
    AND location_updated_at IS NOT NULL
    AND location_updated_at < now() - interval '24 hours';

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_delivery_proof()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM public.delivery_proof WHERE created_at < now() - private.delivery_proof_retention_period();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Kouri chak 15 minit (§10), pa chak jou — se konpwomi a pou "imedya" san
-- yon apèl HTTP soti nan pg_cron (wè kòmantè REVISION #3 anwo tèt fichye
-- a): yon RAISE EXCEPTION nan claim_delivery_secure/self-toggle anile
-- nenpòt notifikasyon ki t ap ekri nan menm apèl la, donk pa gen fason pou
-- "notifye admin la LADAN menm apèl kliyan an bloke a" — 15 minit se pi
-- pre nou ka rive san sa. Frenaj notifikasyon (1 fwa pa è) anpeche spam
-- pandan yon anomali rete san rezoud pandan plizyè èdtan.
CREATE OR REPLACE FUNCTION private.detect_compliance_grace_anomalies()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resto_count int;
  v_driver_count int;
  v_resto_closing_count int;
  v_already_notified boolean;
BEGIN
  SELECT count(*) INTO v_resto_count FROM public.restaurants
    WHERE status = 'approved' AND COALESCE(opening_hours, '{}'::jsonb) = '{}'::jsonb
      AND opening_hours_grace_until IS NULL;
  SELECT count(*) INTO v_driver_count FROM public.drivers
    WHERE account_status = 'active' AND permit_expires_at IS NULL AND permit_grace_until IS NULL;

  -- Siyal separe (pa yon "anomali", yon konsekans nòmal): konbyen restoran
  -- ap vin/deja "fèmen" paske fenèt gras yo ekspire san yo pa antre orè.
  -- Pa gen okenn "balayaj" k ap ekri yon estati pou restoran (is_restaurant_
  -- open() kalkile a lekti), donk pa gen anyen pou "kanpe" — sèlman yon
  -- siyal volim pou admin, menm lespri ak koupsikwi livrè a men san bezwen
  -- yon mekanis abòr.
  SELECT count(*) INTO v_resto_closing_count FROM public.restaurants
    WHERE status = 'approved' AND COALESCE(opening_hours, '{}'::jsonb) = '{}'::jsonb
      AND opening_hours_grace_until IS NOT NULL AND opening_hours_grace_until <= now();

  IF v_resto_count > 0 OR v_driver_count > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.audit_log
      WHERE action = 'compliance.grace_anomaly_detected' AND created_at > now() - interval '1 hour'
    ) INTO v_already_notified;

    PERFORM private.log_audit_event(NULL, 'system', 'compliance.grace_anomaly_detected',
      jsonb_build_object('restaurants_missing_grace', v_resto_count, 'drivers_missing_grace', v_driver_count));

    IF NOT v_already_notified THEN
      PERFORM private.notify_secure(
        ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
        'compliance_grace_anomaly', 'admin',
        'Anomali konfòmite detekte',
        v_driver_count || ' livrè ak ' || v_resto_count || ' restoran gen yon eta gras ki pa ta dwe rive (backfill ta dwe anpeche l).',
        jsonb_build_object('restaurants_missing_grace', v_resto_count, 'drivers_missing_grace', v_driver_count)
      );
    END IF;
  END IF;

  IF v_resto_closing_count >= 5 THEN
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.restaurants_closing_volume',
      jsonb_build_object('count', v_resto_closing_count));
  END IF;

  RETURN v_resto_count + v_driver_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.run_compliance_heartbeat()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.log_audit_event(NULL, 'system', 'compliance.heartbeat', jsonb_build_object('at', now()));
  RETURN 1;
END;
$$;

-- Rapèl SÈLMAN (pa balayaj/pij) — planifye separeman 8h maten lokal
-- (Revizyon #2), pa gwoupe ak tach san bri yo. Kouvri tou de dimansyon
-- (pèmi livrè + orè restoran vid) nan YON SÈL fonksyon, menm mekanis
-- idempotan/rattrapabl pou tou de (demand eksplisit: pa ekri l de fwa).
--
-- ⚠️ Nòt pòte: sa a kreye SÈLMAN notifikasyon nan app (private.notify_secure,
-- deja live, deja gen badge/son/klòch nan header a). Yon vrè PUSH (ki
-- reyèlman reveye telefòn nan) mande yon apèl HTTP soti nan Node
-- (@block65/webcrypto-web-push, VAPID) — pg_cron pa ka fè sa dirèkteman
-- san `pg_net` (ni konfime disponib ni teste sou pwojè sa a). De Vercel
-- Cron slot yo (limit Hobby plan) deja itilize (moncash-reconcile,
-- plop-reconcile). Push reyèl pou rapèl sa yo rete yon swiv separe —
-- flag eksplisitman, pa yon sipozisyon enfrastrikti mwen pa ka verifye.
CREATE OR REPLACE FUNCTION private.send_compliance_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_row record;
  v_stage int;
  v_days_left int;
BEGIN
  -- Rapèl pèmi livrè (J-30/15/7/1). Idempotan/rattrapabl: chak livrè jwenn
  -- SÈL pwochen etap ki poko voye a — yon jou sote pa fè yo pèdi yon etap,
  -- yo resevwa etap ki pi ijan an pwochen fwa job la kouri.
  FOR v_row IN
    SELECT id, user_id, permit_expires_at, last_permit_reminder_stage
    FROM public.drivers
    WHERE account_status = 'active'
      AND permit_expires_at IS NOT NULL
      AND permit_expires_at >= CURRENT_DATE
  LOOP
    v_days_left := v_row.permit_expires_at - CURRENT_DATE;
    v_stage := CASE
      WHEN v_days_left <= 1 THEN 1
      WHEN v_days_left <= 7 THEN 7
      WHEN v_days_left <= 15 THEN 15
      WHEN v_days_left <= 30 THEN 30
      ELSE NULL
    END;
    IF v_stage IS NOT NULL
       AND (v_row.last_permit_reminder_stage IS NULL OR v_row.last_permit_reminder_stage > v_stage) THEN
      PERFORM private.notify_secure(
        ARRAY[v_row.user_id], 'permit_expiring_soon', 'system',
        'Pèmi ou ap ekspire byento',
        'Pèmi ou ap ekspire nan ' || v_days_left || ' jou (' || to_char(v_row.permit_expires_at, 'DD/MM/YYYY')
          || '). Telechaje yon nouvo pèmi anvan sa pou ou pa pèdi aksè ak nouvo kòmand.',
        jsonb_build_object('driver_id', v_row.id, 'days_left', v_days_left)
      );
      IF v_stage = 7 THEN
        PERFORM private.notify_secure(
          ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
          'driver_permit_expiring_soon', 'admin',
          'Pèmi yon livrè ap ekspire',
          'Yon livrè gen pèmi k ap ekspire nan 7 jou.',
          jsonb_build_object('driver_id', v_row.id)
        );
      END IF;
      UPDATE public.drivers SET
        permit_status = CASE WHEN v_stage <= 30 THEN 'expiring_soon' ELSE permit_status END,
        last_permit_reminder_stage = v_stage, last_permit_reminder_sent_at = now()
        WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Rapèl orè restoran vid ki gen yon fenèt gras k ap ekspire (J-7/J-1) —
  -- menm mekanis, chan pataje yo ajoute nan §1.
  FOR v_row IN
    SELECT r.id, r.owner_id, r.opening_hours_grace_until, r.last_hours_reminder_stage
    FROM public.restaurants r
    WHERE r.status = 'approved'
      AND COALESCE(r.opening_hours, '{}'::jsonb) = '{}'::jsonb
      AND r.opening_hours_grace_until IS NOT NULL
      AND r.opening_hours_grace_until >= now()
      AND r.owner_id IS NOT NULL
  LOOP
    v_days_left := (v_row.opening_hours_grace_until::date - CURRENT_DATE);
    v_stage := CASE WHEN v_days_left <= 1 THEN 1 WHEN v_days_left <= 7 THEN 7 ELSE NULL END;
    IF v_stage IS NOT NULL
       AND (v_row.last_hours_reminder_stage IS NULL OR v_row.last_hours_reminder_stage > v_stage) THEN
      PERFORM private.notify_secure(
        ARRAY[v_row.owner_id], 'hours_grace_expiring_soon', 'system',
        'Antre orè ou anvan sa twò ta',
        'Ou gen ' || v_days_left || ' jou pou antre orè louvèti restoran ou nan tablodbò w. '
          || 'Apre sa, kliyan yo pap ka kòmande jiskaske ou ranpli l.',
        jsonb_build_object('restaurant_id', v_row.id, 'days_left', v_days_left)
      );
      UPDATE public.restaurants SET last_hours_reminder_stage = v_stage, last_hours_reminder_sent_at = now()
        WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Orchestrator — SÈLMAN pou relans manyèl/debug (SELECT private.
--    run_daily_compliance_secure();). Pg_cron pa rele fonksyon sa a (§10) —
--    chak tach gen pwòp antre pou vrè izolasyon transaksyon (Revizyon #3).
CREATE OR REPLACE FUNCTION private.run_daily_compliance_secure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result int;
  v_errmsg text;
BEGIN
  BEGIN
    v_result := private.run_permit_suspension_sweep();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.permit_suspension_ran', jsonb_build_object('suspended_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.permit_suspension_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    v_result := private.purge_cron_job_run_details();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.cron_purge_ran', jsonb_build_object('deleted_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.cron_purge_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    v_result := private.sweep_abandoned_delivery_locations();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.location_sweep_ran', jsonb_build_object('swept_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.location_sweep_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    v_result := private.purge_delivery_proof();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.delivery_proof_purge_ran', jsonb_build_object('deleted_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.delivery_proof_purge_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    v_result := private.detect_compliance_grace_anomalies();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.anomaly_check_ran', jsonb_build_object('anomaly_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.anomaly_check_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    PERFORM private.run_compliance_heartbeat();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.heartbeat_failed', jsonb_build_object('error', v_errmsg));
  END;

  BEGIN
    v_result := private.send_compliance_reminders();
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.reminders_ran', jsonb_build_object('sent_count', v_result));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.reminders_failed', jsonb_build_object('error', v_errmsg));
  END;
END;
$$;
REVOKE ALL ON FUNCTION private.run_daily_compliance_secure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.run_daily_compliance_secure() TO service_role;

-- ---------------------------------------------------------------------------
-- 9) Grants sou fonksyon endividyèl yo — service_role sèlman (pg_cron kouri
--    ak wòl ki te pwograme travay la; jamè yon wòl aplikasyon dirèkteman).
REVOKE ALL ON FUNCTION private.run_permit_suspension_sweep(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.run_permit_suspension_sweep(boolean) TO service_role;
REVOKE ALL ON FUNCTION private.purge_cron_job_run_details() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_cron_job_run_details() TO service_role;
REVOKE ALL ON FUNCTION private.sweep_abandoned_delivery_locations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sweep_abandoned_delivery_locations() TO service_role;
REVOKE ALL ON FUNCTION private.purge_delivery_proof() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_delivery_proof() TO service_role;
REVOKE ALL ON FUNCTION private.detect_compliance_grace_anomalies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.detect_compliance_grace_anomalies() TO service_role;
REVOKE ALL ON FUNCTION private.run_compliance_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.run_compliance_heartbeat() TO service_role;
REVOKE ALL ON FUNCTION private.send_compliance_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.send_compliance_reminders() TO service_role;

-- ---------------------------------------------------------------------------
-- 10) Planifikasyon pg_cron — SIS antre separe (pa yon sèl apèl a
--     orchestrator la, Revizyon #3). Ekspresyon yo kalkile pou EDT (UTC-4)
--     kounye a — wè kòmantè DST anwo tèt fichye a anvan aplikasyon.
--
--     ⚠️ 'compliance-permit-suspension' PA PLANIFYE ISIT LA — DE prerekizit,
--     pa yon sèl (Revizyon #4, pwen 4 revizyon pwopriyetè a):
--       1) chemen renouvèlman an (fòm + RPC pou telechaje nouvo pèmi) dwe
--          egziste — otreman livrè yo sispann san okenn fason pou remèt
--          tèt yo an règ.
--       2) fenèt gras 30-jou a (private.driver_permit_grace_period()) dwe
--          fin ekspire pou pak aktyèl la — otreman premye kouri balayaj la
--          ta sispann an mas livrè ki nan règ, san rezon (koupsikwi §7 la
--          ta atrape sa, sa rasire, men pi bon pa bezwen l ditou).
--     Rès migrasyon an (kolòn, fonksyon, heartbeat) aplike kounye a san
--     danje; SÈLMAN antre cron sispansyon an tann tou de kondisyon yo. Yon
--     fwa yo tou de satisfè, kole sa a (pa yon lòt migrasyon apa):
--
--       SELECT cron.schedule('compliance-permit-suspension', '0 8 * * *',
--         $$SELECT private.run_permit_suspension_sweep()$$);
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('compliance-cron-purge', '5 8 * * *',
  $$SELECT private.purge_cron_job_run_details()$$);
SELECT cron.schedule('compliance-location-sweep', '10 8 * * *',
  $$SELECT private.sweep_abandoned_delivery_locations()$$);
SELECT cron.schedule('compliance-delivery-proof-purge', '15 8 * * *',
  $$SELECT private.purge_delivery_proof()$$);
-- Chak 15 minit, pa chak jou (Revizyon #3, point 3b) — pi pre "imedya"
-- pou remonte yon anomali bay admin, bòne pa yon frenaj 1-è nan fonksyon
-- an menm pou pa fè spam pandan yon anomali rete san rezoud.
SELECT cron.schedule('compliance-anomaly-check', '*/15 * * * *',
  $$SELECT private.detect_compliance_grace_anomalies()$$);
SELECT cron.schedule('compliance-heartbeat', '25 8 * * *',
  $$SELECT private.run_compliance_heartbeat()$$);
-- Rapèl — 8h maten lokal (12h00 UTC an EDT), separe eksprè de balayaj san
-- bri anwo yo (Revizyon #2 — pa reveye pèsonn ak yon notifikasyon 4è maten).
SELECT cron.schedule('compliance-reminders', '0 12 * * *',
  $$SELECT private.send_compliance_reminders()$$);

-- ---------------------------------------------------------------------------
-- 11) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821120000', 'driver_compliance_daily_job')
ON CONFLICT (version) DO NOTHING;

COMMIT;
