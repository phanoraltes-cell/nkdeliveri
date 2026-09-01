-- C-01 regression suite (docs/archive/audits/GLOBAL_AUDIT_360_2026-08-13.md, Finding
-- C-01; docs/archive/phases/PHASE0_C01_C02_REMEDIATION_REPORT.md). Persisted version of
-- the BEGIN/ROLLBACK proof run manually against production before
-- migration 20260813110000_fix_user_roles_rls_bypass.sql was applied —
-- kept here so the same guarantee is checked on every CI run instead of
-- only once by hand.
--
-- Run via psql against a fresh local Supabase stack (see
-- .github/workflows/ci.yml's "migrations-db" job, which already boots
-- one via `supabase start` and replays every migration in order — this
-- reuses that stack, no new service/dependency/job type):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/c01_user_roles_security.sql
--
-- Methodology note (see the remediation report for the full
-- explanation): the connecting role for this script must NOT be one
-- that bypasses RLS (a real superuser or the table owner) for the
-- assertions below to mean anything — every write attempt therefore
-- does `SET ROLE authenticated;` (or `anon`) immediately before it, and
-- `RESET ROLE;` immediately after, so it is genuinely evaluated under
-- RLS as that role, not under the connecting superuser.
--
-- This script is intentionally idempotent-safe to re-run: everything
-- happens inside one BEGIN/ROLLBACK, so it never leaves data behind
-- regardless of how many times it runs against the same database.

BEGIN;

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_restaurant_owner uuid := gen_random_uuid();
  v_driver uuid := gen_random_uuid();
  v_super_admin uuid := gen_random_uuid();
  v_second_super_admin uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_session_totp uuid := gen_random_uuid();
  v_session_no_mfa uuid := gen_random_uuid();
  v_caught boolean;
  v_count int;
BEGIN
  -------------------------------------------------------------------------
  -- Fixtures (as the connecting/owner role — bypasses RLS by design,
  -- this part is not what's under test).
  -------------------------------------------------------------------------
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'c01-regress-admin@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'c01-regress-customer@example.com', 'x', now(), '{}', '{}'),
    (v_restaurant_owner, 'c01-regress-restowner@example.com', 'x', now(), '{}', '{}'),
    (v_driver, 'c01-regress-driver@example.com', 'x', now(), '{}', '{}'),
    (v_super_admin, 'c01-regress-superadmin@example.com', 'x', now(), '{}', '{}'),
    (v_second_super_admin, 'c01-regress-superadmin2@example.com', 'x', now(), '{}', '{}'),
    (v_target, 'c01-regress-target@example.com', 'x', now(), '{}', '{}');

  DELETE FROM public.user_roles WHERE user_id IN (v_admin, v_restaurant_owner, v_driver, v_super_admin, v_second_super_admin);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_super_admin, 'super_admin'),
    (v_second_super_admin, 'super_admin'),
    (v_admin, 'admin'),
    (v_restaurant_owner, 'restaurant_owner'),
    (v_driver, 'driver');

  INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, last_challenged_at)
  VALUES (gen_random_uuid(), v_super_admin, 'c01-regress-factor', 'totp', 'verified', now(), now(), now());
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
  VALUES (v_session_totp, v_super_admin, now(), now(), 'aal2');
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
  VALUES (v_session_no_mfa, v_admin, now(), now(), 'aal1');

  -------------------------------------------------------------------------
  -- Direct writes on user_roles: every role, every operation, must be
  -- denied. This is the actual regression guard for the vulnerability.
  -------------------------------------------------------------------------
  SET ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_target, 'admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: anonymous direct INSERT into user_roles succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_customer, 'admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: customer self-escalation direct INSERT succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_restaurant_owner, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_restaurant_owner, 'admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: restaurant_owner direct INSERT succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_driver, 'admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: driver direct INSERT succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_target, 'admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: plain admin direct INSERT succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_target, 'super_admin');
    v_caught := true;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: super_admin direct INSERT (the original C-01 exploit) succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  BEGIN
    UPDATE public.user_roles SET role = 'super_admin' WHERE user_id = v_driver AND role = 'driver';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_caught := v_count > 0;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: super_admin direct UPDATE succeeded'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  BEGIN
    DELETE FROM public.user_roles WHERE user_id = v_admin AND role = 'admin';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_caught := v_count > 0;
  EXCEPTION WHEN OTHERS THEN v_caught := false; END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'REGRESSION: super_admin direct DELETE succeeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_admin AND role = 'admin') THEN
    RAISE EXCEPTION 'REGRESSION-INTEGRITY: admin role missing despite the blocked DELETE';
  END IF;

  -------------------------------------------------------------------------
  -- Read access must remain unaffected.
  -------------------------------------------------------------------------
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.user_roles WHERE user_id = v_customer;
  RESET ROLE;
  IF v_count <> 1 THEN RAISE EXCEPTION 'REGRESSION: self-read of own role row no longer works'; END IF;

  -------------------------------------------------------------------------
  -- The RPC path must remain fully functional (this is not a
  -- vulnerability regression check, it's a "did the fix break the real
  -- feature" check).
  -------------------------------------------------------------------------
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_second_super_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.add_user_role_secure(v_target, 'driver');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'STEP_UP_REQUIRED_MFA%' THEN v_caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'REGRESSION: add_user_role_secure no longer requires step-up MFA'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  PERFORM public.add_user_role_secure(v_target, 'driver');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target AND role = 'driver') THEN
    RAISE EXCEPTION 'REGRESSION: add_user_role_secure with valid step-up no longer grants the role';
  END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.remove_user_role_secure(v_super_admin, 'super_admin');
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'REGRESSION: self-removal of own super_admin role via RPC no longer blocked'; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super_admin, 'role', 'authenticated', 'session_id', v_session_totp::text, 'aal', 'aal2')::text, true);
  PERFORM public.remove_user_role_secure(v_second_super_admin, 'super_admin');
  v_caught := false;
  BEGIN
    PERFORM public.remove_user_role_secure(v_super_admin, 'super_admin');
  EXCEPTION WHEN OTHERS THEN v_caught := true; END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'REGRESSION: removing the last super_admin via RPC no longer blocked'; END IF;

  RAISE NOTICE 'C-01 REGRESSION SUITE: ALL CHECKS PASSED';
END $$;

ROLLBACK;
