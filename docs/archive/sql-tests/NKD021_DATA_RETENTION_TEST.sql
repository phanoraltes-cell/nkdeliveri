-- NKD-021 combined migration + test — WRITTEN, per Règ A1 run this yourself
-- in the SQL Editor (or explicitly authorize it) — never CLI. BEGIN...
-- ROLLBACK — nothing here survives, including the migration itself. Format
-- per Règ A10: results in a temp table + SELECT before ROLLBACK.
--
-- No `SET LOCAL request.jwt.claims` simulation needed here (unlike every
-- other test this project has written) — run_data_retention_cleanup_secure()
-- is a plain GRANT/REVOKE role check (service_role only), not an
-- auth.uid()-based one, so `SET ROLE <role>;` alone is enough to exercise
-- both the rejection and success paths.

BEGIN;

-- =====================  MIGRATION (rehearsal)  =====================
-- Verbatim copy of 20260819120000_nkd021_data_retention.sql (minus the
-- schema_migrations INSERT, not relevant to a rehearsal).

CREATE OR REPLACE FUNCTION public.run_data_retention_cleanup_secure()
RETURNS TABLE (category text, rows_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_limit_deleted bigint;
  v_notifications_deleted bigint;
BEGIN
  DELETE FROM private.rate_limit_hits WHERE window_start < now() - interval '7 days';
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.notifications WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  RETURN QUERY VALUES
    ('rate_limit_hits', v_rate_limit_deleted),
    ('notifications', v_notifications_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.run_data_retention_cleanup_secure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention_cleanup_secure() TO service_role;

-- =====================  TEST (Règ A10 format)  =====================

CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_caught boolean;
  v_stale_rl_count int;
  v_fresh_rl_count int;
  v_stale_notif_count int;
  v_fresh_notif_count int;
  v_summary_rl bigint;
  v_summary_notif bigint;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_user, 'nkd021-user@example.com', 'x', now(), '{}', '{}');

  -- Stale (8 days old, past the 7-day threshold) + fresh (1 day old) rate-limit rows.
  INSERT INTO private.rate_limit_hits (rl_key, window_start, hit_count) VALUES
    ('nkd021-stale', now() - interval '8 days', 3),
    ('nkd021-fresh', now() - interval '1 day', 1);

  -- Stale (91 days old, past the 90-day threshold) + fresh (1 day old) notifications.
  INSERT INTO public.notifications (user_id, type, title, body, created_at) VALUES
    (v_user, 'test', 'Stale', 'stale notification', now() - interval '91 days'),
    (v_user, 'test', 'Fresh', 'fresh notification', now() - interval '1 day');

  -- T1 — 'authenticated' role rejected (no session/JWT claims needed —
  -- this is a plain GRANT/REVOKE check, evaluated before the function body
  -- ever runs).
  SET ROLE authenticated;
  v_caught := false;
  BEGIN
    PERFORM public.run_data_retention_cleanup_secure();
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T1', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'authenticated rejte (permission denied): ' || v_caught::text);

  -- T2 — service_role succeeds. This runs against the REAL production
  -- table, which already carries a month+ of real check_rate_limit_secure
  -- traffic with zero prior cleanup (NKD-011, live since 20260713) — so
  -- rows_deleted will include every genuinely stale production row, not
  -- just this test's one synthetic row. >= 1 is the only honest
  -- assertion here; T3 below is what actually proves the per-row logic
  -- (checking THIS test's own two rows by name, unaffected by however
  -- much real backlog exists). This single call already performs BOTH
  -- DELETEs (rate_limit_hits AND notifications) — T3/T4 check the
  -- resulting state for both from this same call; only T5 later triggers
  -- a genuine second invocation, to test idempotency.
  SET ROLE service_role;
  SELECT rows_deleted INTO v_summary_rl FROM public.run_data_retention_cleanup_secure() WHERE category = 'rate_limit_hits';
  RESET ROLE;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN v_summary_rl >= 1 THEN 'PASS' ELSE 'FAIL' END,
    'rate_limit_hits rows_deleted=' || v_summary_rl::text || ' (>=1 sou yon tab pwodiksyon reyèl ak backlog deja egziste — gade T3 pou prèv egzat sou liy tès la)');

  -- T3 — the actual table state confirms it: stale gone, fresh survives.
  SELECT count(*) INTO v_stale_rl_count FROM private.rate_limit_hits WHERE rl_key = 'nkd021-stale';
  SELECT count(*) INTO v_fresh_rl_count FROM private.rate_limit_hits WHERE rl_key = 'nkd021-fresh';
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN v_stale_rl_count = 0 AND v_fresh_rl_count = 1 THEN 'PASS' ELSE 'FAIL' END,
    'stale=' || v_stale_rl_count::text || ' fresh=' || v_fresh_rl_count::text);

  -- T4 — same for notifications (a fresh call, since T2/T3 already
  -- consumed the notifications side-effect of the first run too — the
  -- DELETEs already happened, this just verifies the resulting state).
  SELECT count(*) INTO v_stale_notif_count FROM public.notifications WHERE user_id = v_user AND title = 'Stale';
  SELECT count(*) INTO v_fresh_notif_count FROM public.notifications WHERE user_id = v_user AND title = 'Fresh';
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN v_stale_notif_count = 0 AND v_fresh_notif_count = 1 THEN 'PASS' ELSE 'FAIL' END,
    'stale=' || v_stale_notif_count::text || ' fresh=' || v_fresh_notif_count::text);

  -- T5 — idempotent: running it again finds nothing left to delete.
  SET ROLE service_role;
  SELECT rows_deleted INTO v_summary_notif FROM public.run_data_retention_cleanup_secure() WHERE category = 'notifications';
  RESET ROLE;
  INSERT INTO test_results VALUES ('T5',
    CASE WHEN v_summary_notif = 0 THEN 'PASS' ELSE 'FAIL' END,
    'dezyèm kouri, notifications rows_deleted=' || v_summary_notif::text || ' (dwe 0, tout deja efase)');
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
