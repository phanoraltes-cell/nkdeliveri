-- Tès pou 20260821120000_driver_compliance_daily_job.sql.
-- REHEARSE-STYLE (BEGIN...ROLLBACK) — migrasyon an poko aplike an
-- pwodiksyon. Fichye sa a OTO-PÒTAN pou PWÒP kò li (20260821120000), SAN
-- seksyon 10 pg_cron — cron.schedule() pa dwe kouri nan yon rehearsal ki
-- pral ROLLBACK, li pa transaksyonèl menm jan ak DDL nòmal.
--
-- ⚠️ DEPANDANS EKSPLISIT (pa yon sipozisyon san mansyone) — fichye sa a
-- PA re-kole kò 2 migrasyon anvan yo nan menm chantye a, li SIPOZE yo deja
-- aplike an pwodiksyon lè ou kouri tès sa a:
--   - 20260821090000 (fix_delivery_location_retention_leak) — bezwen pou
--     tab `delivery_proof` egziste (T18/T19/§8 sweep_abandoned/purge).
--   - 20260821100000 (restaurant_open_check_order_creation) — bezwen pou
--     kolòn `opening_hours_grace_until` + trigger li egziste (T17,
--     restoran tès la konte sou trigger sa a pou jwenn yon fenèt gras sou
--     INSERT, jan brye pwodiksyon an ta fè l).
-- Si w kouri tès sa a AVAN de premye yo, ou ap jwenn erè "column/relation
-- does not exist" — se pa yon bug nan tès la, se lòd aplikasyon an ki pa
-- respekte.
-- Règ A10: rezilta ekri nan yon tab tanporè + SELECT anvan ROLLBACK.

BEGIN;

-- ===========================================================================
-- Kò migrasyon an (verbatim, san BEGIN/COMMIT/schema_migrations/§10 li).
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

CREATE OR REPLACE FUNCTION private.driver_permit_grace_period()
RETURNS interval LANGUAGE sql IMMUTABLE
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

UPDATE public.drivers
SET permit_grace_until = now() + private.driver_permit_grace_period()
WHERE permit_expires_at IS NULL AND permit_grace_until IS NULL
  AND status IN ('approved', 'online', 'offline');

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
  IF v_driver.status NOT IN ('approved', 'online', 'offline') THEN RETURN false; END IF;
  IF v_driver.account_status <> 'active' THEN RETURN false; END IF;
  IF v_driver.permit_expires_at IS NOT NULL AND v_driver.permit_expires_at < CURRENT_DATE THEN
    RETURN false;
  END IF;
  IF v_driver.permit_expires_at IS NULL THEN
    RETURN v_driver.permit_grace_until IS NOT NULL AND v_driver.permit_grace_until > now();
  END IF;
  RETURN true;
END;
$$;

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
    RETURN 'permit_grace_period';
  END IF;
  RETURN 'ok';
END;
$$;

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
    RETURN;
  END IF;
  PERFORM private.notify_secure(
    ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
    'driver_permit_anomaly_reported', 'admin', 'Livrè rapòte yon pwoblèm pèmi',
    'Yon livrè rapòte li pa ka verifye pèmi li — verifye kont li.', jsonb_build_object('driver_id', v_driver_id)
  );
  PERFORM private.log_audit_event(auth.uid(), 'driver', 'compliance.permit_anomaly_reported',
    jsonb_build_object('driver_id', v_driver_id));
END;
$$;

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
    status_history = status_history || jsonb_build_object('from', v_order.status, 'to', 'assigned', 'by', auth.uid(), 'at', now()),
    updated_at = now()
  WHERE id = _order_id;
  RETURN v_row;
END;
$function$;

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

CREATE OR REPLACE FUNCTION private.delivery_proof_retention_period()
RETURNS interval LANGUAGE sql IMMUTABLE
AS $$ SELECT interval '90 days' $$;

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

  SELECT count(*) INTO v_active_population FROM public.drivers WHERE account_status = 'active';
  v_threshold := GREATEST(10, CEIL(v_active_population * 0.2));

  IF v_candidate_count > v_threshold AND NOT _force THEN
    SELECT array_agg(id) INTO v_ids FROM public.drivers
      WHERE account_status = 'active' AND permit_expires_at IS NOT NULL AND permit_expires_at < CURRENT_DATE;
    PERFORM private.log_audit_event(NULL, 'system', 'compliance.permit_sweep_aborted_threshold',
      jsonb_build_object('candidate_count', v_candidate_count, 'threshold', v_threshold, 'driver_ids', to_jsonb(v_ids)));
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'permit_sweep_aborted', 'admin', 'Balayaj sispansyon pèmi kanpe — twòp livrè',
      v_candidate_count || ' livrè te pral sispann nan yon sèl kou (limit: ' || v_threshold || ').',
      jsonb_build_object('candidate_count', v_candidate_count, 'threshold', v_threshold)
    );
    RETURN -1;
  END IF;

  FOR v_row IN
    SELECT id, user_id, permit_expires_at FROM public.drivers
    WHERE account_status = 'active' AND permit_expires_at IS NOT NULL AND permit_expires_at < CURRENT_DATE
    FOR UPDATE
  LOOP
    UPDATE public.drivers SET
      account_status = 'suspended_permit',
      status = CASE WHEN status = 'online' THEN 'offline'::public.driver_status ELSE status END,
      permit_status = 'expired',
      suspended_reason = 'Pèmi ekspire depi ' || to_char(v_row.permit_expires_at, 'DD/MM/YYYY') || '.',
      suspended_at = now()
    WHERE id = v_row.id;
    PERFORM private.notify_secure(ARRAY[v_row.user_id], 'permit_expired', 'system', 'Pèmi ou ekspire',
      'Pèmi ou ekspire depi ' || to_char(v_row.permit_expires_at, 'DD/MM/YYYY') || '.', jsonb_build_object('driver_id', v_row.id));
    PERFORM private.notify_secure(ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'driver_permit_expired', 'admin', 'Pèmi yon livrè ekspire', 'Yon livrè sispann otomatikman.', jsonb_build_object('driver_id', v_row.id));
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
DECLARE v_count int;
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
DECLARE v_count int;
BEGIN
  INSERT INTO public.delivery_proof (delivery_id, final_driver_lat, final_driver_lng, final_location_at, final_status)
  SELECT id, driver_lat, driver_lng, location_updated_at, 'abandoned_retention_sweep'
  FROM public.deliveries
  WHERE status NOT IN ('delivered', 'cancelled', 'delivery_failed')
    AND location_updated_at IS NOT NULL AND location_updated_at < now() - interval '24 hours'
  ON CONFLICT (delivery_id) DO UPDATE SET
    final_driver_lat = EXCLUDED.final_driver_lat, final_driver_lng = EXCLUDED.final_driver_lng,
    final_location_at = EXCLUDED.final_location_at, final_status = EXCLUDED.final_status;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.deliveries SET driver_lat = NULL, driver_lng = NULL, driver_heading = NULL, location_updated_at = NULL
  WHERE status NOT IN ('delivered', 'cancelled', 'delivery_failed')
    AND location_updated_at IS NOT NULL AND location_updated_at < now() - interval '24 hours';
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_delivery_proof()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM public.delivery_proof WHERE created_at < now() - private.delivery_proof_retention_period();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.detect_compliance_grace_anomalies()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resto_count int; v_driver_count int; v_resto_closing_count int; v_already_notified boolean;
BEGIN
  SELECT count(*) INTO v_resto_count FROM public.restaurants
    WHERE status = 'approved' AND COALESCE(opening_hours, '{}'::jsonb) = '{}'::jsonb AND opening_hours_grace_until IS NULL;
  SELECT count(*) INTO v_driver_count FROM public.drivers
    WHERE account_status = 'active' AND permit_expires_at IS NULL AND permit_grace_until IS NULL;
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
        'compliance_grace_anomaly', 'admin', 'Anomali konfòmite detekte',
        v_driver_count || ' livrè ak ' || v_resto_count || ' restoran gen yon eta gras ki pa ta dwe rive.',
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

CREATE OR REPLACE FUNCTION private.send_compliance_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0; v_row record; v_stage int; v_days_left int;
BEGIN
  FOR v_row IN
    SELECT id, user_id, permit_expires_at, last_permit_reminder_stage FROM public.drivers
    WHERE account_status = 'active' AND permit_expires_at IS NOT NULL AND permit_expires_at >= CURRENT_DATE
  LOOP
    v_days_left := v_row.permit_expires_at - CURRENT_DATE;
    v_stage := CASE WHEN v_days_left <= 1 THEN 1 WHEN v_days_left <= 7 THEN 7
      WHEN v_days_left <= 15 THEN 15 WHEN v_days_left <= 30 THEN 30 ELSE NULL END;
    IF v_stage IS NOT NULL AND (v_row.last_permit_reminder_stage IS NULL OR v_row.last_permit_reminder_stage > v_stage) THEN
      PERFORM private.notify_secure(ARRAY[v_row.user_id], 'permit_expiring_soon', 'system', 'Pèmi ou ap ekspire byento',
        'Pèmi ou ap ekspire nan ' || v_days_left || ' jou.', jsonb_build_object('driver_id', v_row.id, 'days_left', v_days_left));
      IF v_stage = 7 THEN
        PERFORM private.notify_secure(ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
          'driver_permit_expiring_soon', 'admin', 'Pèmi yon livrè ap ekspire', 'Yon livrè gen pèmi k ap ekspire nan 7 jou.',
          jsonb_build_object('driver_id', v_row.id));
      END IF;
      UPDATE public.drivers SET
        permit_status = CASE WHEN v_stage <= 30 THEN 'expiring_soon' ELSE permit_status END,
        last_permit_reminder_stage = v_stage, last_permit_reminder_sent_at = now()
        WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT r.id, r.owner_id, r.opening_hours_grace_until, r.last_hours_reminder_stage FROM public.restaurants r
    WHERE r.status = 'approved' AND COALESCE(r.opening_hours, '{}'::jsonb) = '{}'::jsonb
      AND r.opening_hours_grace_until IS NOT NULL AND r.opening_hours_grace_until >= now() AND r.owner_id IS NOT NULL
  LOOP
    v_days_left := (v_row.opening_hours_grace_until::date - CURRENT_DATE);
    v_stage := CASE WHEN v_days_left <= 1 THEN 1 WHEN v_days_left <= 7 THEN 7 ELSE NULL END;
    IF v_stage IS NOT NULL AND (v_row.last_hours_reminder_stage IS NULL OR v_row.last_hours_reminder_stage > v_stage) THEN
      PERFORM private.notify_secure(ARRAY[v_row.owner_id], 'hours_grace_expiring_soon', 'system', 'Antre orè ou anvan sa twò ta',
        'Ou gen ' || v_days_left || ' jou pou antre orè ou.', jsonb_build_object('restaurant_id', v_row.id, 'days_left', v_days_left));
      UPDATE public.restaurants SET last_hours_reminder_stage = v_stage, last_hours_reminder_sent_at = now() WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.run_daily_compliance_secure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result int; v_errmsg text;
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

-- ===========================================================================
-- Tès yo.
CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_d_ok uuid; v_d_susp_admin uuid; v_d_susp_permit uuid; v_d_expired_live uuid;
  v_d_grace_active uuid; v_d_grace_expired uuid; v_d_grace_null uuid; v_d_reminder uuid;
  v_du_ok uuid; v_du_susp_admin uuid; v_du_susp_permit uuid; v_du_expired_live uuid;
  v_du_grace_active uuid; v_du_grace_expired uuid; v_du_grace_null uuid; v_du_reminder uuid;
  v_order1 uuid; v_delivery1 uuid; v_delivery_abandoned uuid;
  v_caught boolean; v_errmsg text; v_count int; v_row record;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'compl-admin@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'compl-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'compl-test-resto', 'Compl Test Resto', 'approved', 0);

  -- Livrè tès: chak senaryo gen pwòp itilizatè + pwòp liy drivers.
  v_du_ok := gen_random_uuid();
  v_du_susp_admin := gen_random_uuid();
  v_du_susp_permit := gen_random_uuid();
  v_du_expired_live := gen_random_uuid();
  v_du_grace_active := gen_random_uuid();
  v_du_grace_expired := gen_random_uuid();
  v_du_grace_null := gen_random_uuid();
  v_du_reminder := gen_random_uuid();
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_du_ok, 'compl-d-ok@example.com', 'x', now(), '{}', '{}'),
    (v_du_susp_admin, 'compl-d-susp-admin@example.com', 'x', now(), '{}', '{}'),
    (v_du_susp_permit, 'compl-d-susp-permit@example.com', 'x', now(), '{}', '{}'),
    (v_du_expired_live, 'compl-d-expired-live@example.com', 'x', now(), '{}', '{}'),
    (v_du_grace_active, 'compl-d-grace-active@example.com', 'x', now(), '{}', '{}'),
    (v_du_grace_expired, 'compl-d-grace-expired@example.com', 'x', now(), '{}', '{}'),
    (v_du_grace_null, 'compl-d-grace-null@example.com', 'x', now(), '{}', '{}'),
    (v_du_reminder, 'compl-d-reminder@example.com', 'x', now(), '{}', '{}');

  -- T1 — dwa: valid, apwouve, elijib.
  INSERT INTO public.drivers (id, user_id, status, permit_expires_at)
  VALUES (gen_random_uuid(), v_du_ok, 'online', CURRENT_DATE + 100) RETURNING id INTO v_d_ok;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN public.is_driver_eligible(v_d_ok) THEN 'PASS' ELSE 'FAIL' END,
    'livrè valid+apwouve+online = elijib');

  -- T2 — presedans: sispansyon admin (status) genyen sou account_status='active'
  -- e yon pèmi valid.
  INSERT INTO public.drivers (id, user_id, status, account_status, permit_expires_at)
  VALUES (gen_random_uuid(), v_du_susp_admin, 'suspended', 'active', CURRENT_DATE + 100) RETURNING id INTO v_d_susp_admin;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN NOT public.is_driver_eligible(v_d_susp_admin) THEN 'PASS' ELSE 'FAIL' END,
    'status=suspended genyen sou account_status=active + pèmi valid');

  -- T3 — account_status suspended_permit bloke, menm ak status='online'.
  INSERT INTO public.drivers (id, user_id, status, account_status, permit_expires_at)
  VALUES (gen_random_uuid(), v_du_susp_permit, 'online', 'suspended_permit', CURRENT_DATE + 100) RETURNING id INTO v_d_susp_permit;
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN NOT public.is_driver_eligible(v_d_susp_permit) THEN 'PASS' ELSE 'FAIL' END,
    'account_status=suspended_permit bloke menm ak status=online');

  -- T4 — chèk DIRÈK sou pèmi ekspire, menm si account_status toujou 'active'
  -- (kwontab la poko pase) — Règ eksplisit pwopriyetè a.
  INSERT INTO public.drivers (id, user_id, status, account_status, permit_expires_at)
  VALUES (gen_random_uuid(), v_du_expired_live, 'online', 'active', CURRENT_DATE - 1) RETURNING id INTO v_d_expired_live;
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN NOT public.is_driver_eligible(v_d_expired_live) THEN 'PASS' ELSE 'FAIL' END,
    'pèmi ekspire ayè, account_status toujou active (kwontab poko pase) = pa elijib');

  -- T5 — trigger la bay yon fenèt gras otomatikman sou INSERT (~30 jou),
  -- pèmi vid + gras aktif = elijib.
  INSERT INTO public.drivers (id, user_id, status, account_status)
  VALUES (gen_random_uuid(), v_du_grace_active, 'online', 'active') RETURNING id INTO v_d_grace_active;
  INSERT INTO test_results VALUES ('T5a',
    CASE WHEN (SELECT permit_grace_until FROM public.drivers WHERE id = v_d_grace_active) > now() + interval '29 days' THEN 'PASS' ELSE 'FAIL' END,
    'permit_grace_until otomatik sou insert (~30 jou)');
  INSERT INTO test_results VALUES ('T5b',
    CASE WHEN public.is_driver_eligible(v_d_grace_active) THEN 'PASS' ELSE 'FAIL' END,
    'pèmi vid + gras aktif = elijib');

  -- T6 — pèmi vid + gras ekspire = PA elijib.
  INSERT INTO public.drivers (id, user_id, status, account_status)
  VALUES (gen_random_uuid(), v_du_grace_expired, 'online', 'active') RETURNING id INTO v_d_grace_expired;
  UPDATE public.drivers SET permit_grace_until = now() - interval '1 day' WHERE id = v_d_grace_expired;
  INSERT INTO test_results VALUES ('T6',
    CASE WHEN NOT public.is_driver_eligible(v_d_grace_expired) THEN 'PASS' ELSE 'FAIL' END,
    'pèmi vid + gras ekspire = pa elijib');

  -- T7 — filè sekirite fè PA elijib (opoze ak restaurants, wè kòmantè
  -- migrasyon an §3): pèmi vid + gras FÒSE NULL.
  INSERT INTO public.drivers (id, user_id, status, account_status)
  VALUES (gen_random_uuid(), v_du_grace_null, 'online', 'active') RETURNING id INTO v_d_grace_null;
  UPDATE public.drivers SET permit_grace_until = NULL WHERE id = v_d_grace_null;
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN NOT public.is_driver_eligible(v_d_grace_null) THEN 'PASS' ELSE 'FAIL' END,
    'pèmi vid + gras NULL (anomali) = pa elijib (fail-closed, opoze ak restoran)');

  -- T8 — trigger la efase permit_grace_until lè yon vrè dat antre.
  UPDATE public.drivers SET permit_expires_at = CURRENT_DATE + 50 WHERE id = v_d_grace_active;
  INSERT INTO test_results VALUES ('T8',
    CASE WHEN (SELECT permit_grace_until FROM public.drivers WHERE id = v_d_grace_active) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'permit_grace_until efase apre vrè dat antre');

  -- T9 — claim_delivery_secure rejte yon livrè ki online men pa elijib.
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total, status)
  VALUES (gen_random_uuid(), v_owner, v_restaurant, 'Adrès', '50900000000', 100, 100, 'ready') RETURNING id INTO v_order1;
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_susp_permit, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.claim_delivery_secure(v_order1);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9',
    CASE WHEN v_caught AND v_errmsg = 'Ou pa ka pran yon livrezon kounye a — verifye estati kont ou.' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T9b — mesaj DIFERAN pou yon anomali (permit_grace_until fòse NULL,
  -- v_d_grace_null soti T7) — pa menm tèks ak yon vrè pèmi ekspire.
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total, status)
  VALUES (gen_random_uuid(), v_owner, v_restaurant, 'Adrès anomali', '50900000000', 100, 100, 'ready');
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_grace_null, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.claim_delivery_secure((SELECT id FROM public.orders WHERE delivery_address = 'Adrès anomali'));
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9b',
    CASE WHEN v_caught AND v_errmsg = 'Nou pa rive verifye pèmi ou. Kontakte sipò a oswa telechaje pèmi ou ankò.' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj anomali: ' || COALESCE(v_errmsg, 'okenn'));

  -- T9c — driver_ineligibility_reason retounen 'permit_grace_period' (pa
  -- yon rejè) pou yon livrè ELIJIB k ap travay sou fenèt gras. Livrè fre,
  -- pa v_d_grace_active (T8 deja modifye li pou gen yon vrè dat).
  DECLARE
    v_du_grace_fresh uuid := gen_random_uuid();
    v_d_grace_fresh uuid;
  BEGIN
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (v_du_grace_fresh, 'compl-d-grace-fresh@example.com', 'x', now(), '{}', '{}');
    INSERT INTO public.drivers (id, user_id, status, account_status)
    VALUES (gen_random_uuid(), v_du_grace_fresh, 'online', 'active') RETURNING id INTO v_d_grace_fresh;
    INSERT INTO test_results VALUES ('T9c',
      CASE WHEN private.driver_ineligibility_reason(v_d_grace_fresh) = 'permit_grace_period'
             AND public.is_driver_eligible(v_d_grace_fresh)
           THEN 'PASS' ELSE 'FAIL' END,
      'rezon=' || private.driver_ineligibility_reason(v_d_grace_fresh) || ', elijib=' || public.is_driver_eligible(v_d_grace_fresh)::text);
  END;

  -- T9d — report_permit_anomaly_secure: no-op (pa notifye) pou yon livrè
  -- ki PA gen anomali reyèl (verifikasyon sèvè-side, pa konfyans a kliyan).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_ok, 'role', 'authenticated')::text, true);
  PERFORM public.report_permit_anomaly_secure();
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9d',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'compliance.permit_anomaly_reported')
         THEN 'PASS' ELSE 'FAIL' END,
    'pa gen rapò kreye pou livrè san anomali');

  -- T9e — report_permit_anomaly_secure: rapòte vre pou yon livrè ak yon
  -- vrè anomali (v_d_grace_null).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_grace_null, 'role', 'authenticated')::text, true);
  PERFORM public.report_permit_anomaly_secure();
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9e',
    CASE WHEN EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'compliance.permit_anomaly_reported')
         THEN 'PASS' ELSE 'FAIL' END,
    'rapò kreye pou livrè ak vrè anomali');

  -- T10 — claim_delivery_secure toujou reyisi pou yon livrè elijib (pa gen
  -- regresyon sou chemen nòmal la).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_ok, 'role', 'authenticated')::text, true);
  PERFORM public.claim_delivery_secure(v_order1);
  RESET ROLE;
  SELECT id INTO v_delivery1 FROM public.deliveries WHERE order_id = v_order1;
  INSERT INTO test_results VALUES ('T10',
    CASE WHEN v_delivery1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'livrè elijib reyisi pran livrezon: ' || (v_delivery1 IS NOT NULL)::text);

  -- T11 — pwoteksyon self-toggle: yon livrè pa elijib pa ka mete tèt li
  -- online.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_du_susp_permit, 'role', 'authenticated')::text, true);
  UPDATE public.drivers SET status = 'offline' WHERE id = v_d_susp_permit; -- online->offline toujou ok
  v_caught := false;
  BEGIN
    UPDATE public.drivers SET status = 'online' WHERE id = v_d_susp_permit;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T11', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'livrè pa elijib pa ka pase online: ' || v_caught::text);

  -- T12 — admin toujou ka fòse chanjman status kèlkeswa elijiblite (bypass
  -- pa afekte).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    UPDATE public.drivers SET status = 'online' WHERE id = v_d_susp_permit;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T12', CASE WHEN NOT v_caught THEN 'PASS' ELSE 'FAIL' END,
    'admin bypass toujou fonksyone: ' || (NOT v_caught)::text);

  -- T13 — run_permit_suspension_sweep sispann yon livrè aktif ak pèmi ekspire.
  UPDATE public.drivers SET status = 'online', account_status = 'active' WHERE id = v_d_expired_live;
  v_count := private.run_permit_suspension_sweep();
  SELECT account_status, status, permit_status INTO v_row FROM public.drivers WHERE id = v_d_expired_live;
  INSERT INTO test_results VALUES ('T13',
    CASE WHEN v_count >= 1 AND v_row.account_status = 'suspended_permit' AND v_row.status = 'offline' AND v_row.permit_status = 'expired'
         THEN 'PASS' ELSE 'FAIL' END,
    'apre balayaj: account_status=' || v_row.account_status || ' status=' || v_row.status);

  -- T14 — balayaj la pa touche yon livrè ki toujou valid.
  SELECT account_status INTO v_row FROM public.drivers WHERE id = v_d_ok;
  INSERT INTO test_results VALUES ('T14',
    CASE WHEN v_row.account_status = 'active' THEN 'PASS' ELSE 'FAIL' END,
    'livrè valid pa touche pa balayaj la');

  -- T13b/c/d — koupsikwi mas: 12 livrè (> plafon minimòm 10) ak pèmi ekspire
  -- nan yon sèl kou pa dwe sispann otomatikman.
  DECLARE
    v_mass_ids uuid[] := ARRAY[]::uuid[];
    v_mass_uid uuid;
    v_mass_did uuid;
    i int;
    v_sweep_result int;
    v_still_active_count int;
    v_now_suspended_count int;
  BEGIN
    FOR i IN 1..12 LOOP
      v_mass_uid := gen_random_uuid();
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      VALUES (v_mass_uid, 'compl-mass-' || i || '@example.com', 'x', now(), '{}', '{}');
      INSERT INTO public.drivers (id, user_id, status, account_status, permit_expires_at)
      VALUES (gen_random_uuid(), v_mass_uid, 'online', 'active', CURRENT_DATE - 1)
      RETURNING id INTO v_mass_did;
      v_mass_ids := array_append(v_mass_ids, v_mass_did);
    END LOOP;

    v_sweep_result := private.run_permit_suspension_sweep();
    SELECT count(*) INTO v_still_active_count FROM public.drivers WHERE id = ANY(v_mass_ids) AND account_status = 'active';
    INSERT INTO test_results VALUES ('T13b',
      CASE WHEN v_sweep_result = -1 AND v_still_active_count = 12 THEN 'PASS' ELSE 'FAIL' END,
      'balayaj kanpe (rezilta=' || v_sweep_result || '), 12 livrè rete active san touche');
    INSERT INTO test_results VALUES ('T13c',
      CASE WHEN EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'compliance.permit_sweep_aborted_threshold')
           THEN 'PASS' ELSE 'FAIL' END,
      'kanpe a logue nan audit_log');

    v_sweep_result := private.run_permit_suspension_sweep(true);
    SELECT count(*) INTO v_now_suspended_count FROM public.drivers WHERE id = ANY(v_mass_ids) AND account_status = 'suspended_permit';
    INSERT INTO test_results VALUES ('T13d',
      CASE WHEN v_sweep_result = 12 AND v_now_suspended_count = 12 THEN 'PASS' ELSE 'FAIL' END,
      '_force=true bypass koupsikwi a, sispann tout 12: rezilta=' || v_sweep_result);
  END;

  -- T15 — send_compliance_reminders voye rapèl etap 7 pou yon pèmi k ap
  -- ekspire nan 5 jou, mete ajou last_permit_reminder_stage.
  INSERT INTO public.drivers (id, user_id, status, account_status, permit_expires_at)
  VALUES (gen_random_uuid(), v_du_reminder, 'online', 'active', CURRENT_DATE + 5) RETURNING id INTO v_d_reminder;
  v_count := private.send_compliance_reminders();
  SELECT last_permit_reminder_stage INTO v_row FROM public.drivers WHERE id = v_d_reminder;
  INSERT INTO test_results VALUES ('T15',
    CASE WHEN v_row.last_permit_reminder_stage = 7 THEN 'PASS' ELSE 'FAIL' END,
    'etap rapèl apre premye kouri: ' || COALESCE(v_row.last_permit_reminder_stage::text, 'NULL'));

  -- T16 — dezyèm kouri MENM jou a pa reanvoye MENM etap la (idempotan).
  v_count := private.send_compliance_reminders();
  SELECT last_permit_reminder_stage INTO v_row FROM public.drivers WHERE id = v_d_reminder;
  INSERT INTO test_results VALUES ('T16',
    CASE WHEN v_row.last_permit_reminder_stage = 7 THEN 'PASS' ELSE 'FAIL' END,
    'etap rete 7 apre dezyèm kouri (pa reanvoye): ' || COALESCE(v_row.last_permit_reminder_stage::text, 'NULL'));

  -- T17 — rapèl orè restoran (J-7) voye lè fenèt gras ap ekspire nan 5 jou.
  UPDATE public.restaurants SET opening_hours_grace_until = now() + interval '5 days' WHERE id = v_restaurant;
  v_count := private.send_compliance_reminders();
  SELECT last_hours_reminder_stage INTO v_row FROM public.restaurants WHERE id = v_restaurant;
  INSERT INTO test_results VALUES ('T17',
    CASE WHEN v_row.last_hours_reminder_stage = 7 THEN 'PASS' ELSE 'FAIL' END,
    'rapèl orè restoran voye, etap=' || COALESCE(v_row.last_hours_reminder_stage::text, 'NULL'));

  -- T18 — sweep_abandoned_delivery_locations kaptire prèv + efase pozisyon
  -- yon livrezon ki pa terminal e ki gen plis pase 24è san MAJ.
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total, status)
  VALUES (gen_random_uuid(), v_owner, v_restaurant, 'Adrès 2', '50900000000', 100, 100, 'assigned');
  INSERT INTO public.deliveries (id, order_id, driver_id, status, fee, driver_lat, driver_lng, location_updated_at)
  SELECT gen_random_uuid(), o.id, v_d_ok, 'assigned', 100, 19.4, -72.6, now() - interval '25 hours'
  FROM public.orders o WHERE o.delivery_address = 'Adrès 2'
  RETURNING id INTO v_delivery_abandoned;
  v_count := private.sweep_abandoned_delivery_locations();
  SELECT driver_lat INTO v_row FROM public.deliveries WHERE id = v_delivery_abandoned;
  INSERT INTO test_results VALUES ('T18a',
    CASE WHEN v_count >= 1 AND v_row.driver_lat IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'pozisyon abandone efase apre balayaj');
  INSERT INTO test_results VALUES ('T18b',
    CASE WHEN EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery_abandoned AND final_status = 'abandoned_retention_sweep')
         THEN 'PASS' ELSE 'FAIL' END,
    'prèv kaptire pou pozisyon abandone a');

  -- T19 — purge_delivery_proof efase ranje ki gen plis pase 90 jou, kenbe
  -- pi resan yo.
  INSERT INTO public.delivery_proof (delivery_id, final_driver_lat, final_driver_lng, final_status, created_at)
  VALUES (v_delivery1, 19.1, -72.1, 'delivered', now() - interval '91 days');
  v_count := private.purge_delivery_proof();
  INSERT INTO test_results VALUES ('T19',
    CASE WHEN v_count >= 1 AND NOT EXISTS (
      SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery1 AND created_at < now() - interval '90 days'
    ) AND EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery_abandoned)
    THEN 'PASS' ELSE 'FAIL' END,
    'ranje >90j efase, ranje resan kenbe: ' || v_count::text);

  -- T20 — detect_compliance_grace_anomalies detekte + logue lè gen youn.
  -- (v_d_grace_null soti T7 la toujou gen permit_grace_until=NULL.)
  v_count := private.detect_compliance_grace_anomalies();
  INSERT INTO test_results VALUES ('T20a',
    CASE WHEN v_count >= 1 THEN 'PASS' ELSE 'FAIL' END, 'anomali detekte: ' || v_count::text);
  INSERT INTO test_results VALUES ('T20b',
    CASE WHEN EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'compliance.grace_anomaly_detected')
         THEN 'PASS' ELSE 'FAIL' END, 'anomali logue nan audit_log');

  -- T21 — heartbeat logue.
  PERFORM private.run_compliance_heartbeat();
  INSERT INTO test_results VALUES ('T21',
    CASE WHEN EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'compliance.heartbeat')
         THEN 'PASS' ELSE 'FAIL' END, 'heartbeat logue');

  -- T22 — orchestrator relans manyèl la kouri san leve okenn erè, e chak
  -- tach logue pwòp rezilta li (menm si youn ta echwe, wè kòmantè
  -- migrasyon an §8).
  v_caught := false;
  BEGIN
    PERFORM private.run_daily_compliance_secure();
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  INSERT INTO test_results VALUES ('T22a', CASE WHEN NOT v_caught THEN 'PASS' ELSE 'FAIL' END,
    'orchestrator manyèl kouri san leve erè');
  SELECT count(*) INTO v_count FROM public.audit_log WHERE action LIKE 'compliance.%_ran' AND created_at > now() - interval '1 minute';
  INSERT INTO test_results VALUES ('T22b',
    CASE WHEN v_count >= 6 THEN 'PASS' ELSE 'FAIL' END,
    'omwen 6 tach logue apre relans orchestrator la: ' || v_count::text);
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
