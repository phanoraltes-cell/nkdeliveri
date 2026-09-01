-- NKD-006 verification test — WRITTEN, NOT EXECUTED.
--
-- Per the 2026-08-14 CLI credential incident
-- (docs/INCIDENT_2026-08-14_CLI_CREDENTIAL.md), this session does not run
-- database queries autonomously right now. Run this in the Supabase SQL
-- Editor (or explicitly authorize it to be run) and paste the result back.
--
-- Tests the CHECK constraint added by
-- supabase/migrations/20260814150000_nkd006_push_endpoint_allowlist.sql
-- in isolation (BEGIN...ROLLBACK — nothing is kept). Uses a syntheticv
-- auth.users row so it doesn't depend on any real user existing.

BEGIN;

-- 1. Apply the migration inside this same transaction.
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_allowlist CHECK (
    endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)(/.*)?$'
  );

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_user, 'nkd006-test@example.com', 'x', now(), '{}', '{}');

  -- T1: the exact "before" exploit — a cloud metadata URL — must now be
  -- rejected by the CHECK constraint.
  v_caught := false;
  BEGIN
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_user, 'http://169.254.169.254/latest/meta-data/', 'p', 'a');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T1-FAIL: cloud metadata endpoint was accepted'; END IF;
  RAISE NOTICE 'T1-PASS: cloud metadata endpoint rejected';

  -- T2: an arbitrary attacker-controlled host — must be rejected.
  v_caught := false;
  BEGIN
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_user, 'https://attacker.example/collect', 'p', 'a');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T2-FAIL: attacker-controlled host was accepted'; END IF;
  RAISE NOTICE 'T2-PASS: attacker-controlled host rejected';

  -- T3: host-suffix trick — an allowed hostname as a mere prefix — must
  -- be rejected (proves the regex anchors the host correctly).
  v_caught := false;
  BEGIN
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_user, 'https://fcm.googleapis.com.evil.com/x', 'p', 'a');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T3-FAIL: host-suffix trick was accepted'; END IF;
  RAISE NOTICE 'T3-PASS: host-suffix trick rejected';

  -- T4: a real, valid FCM endpoint — must be accepted (non-regression:
  -- the fix must not break legitimate Chrome/Edge subscriptions).
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (v_user, 'https://fcm.googleapis.com/fcm/send/a1b2c3d4e5', 'p', 'a');
  IF NOT EXISTS (
    SELECT 1 FROM public.push_subscriptions
    WHERE user_id = v_user AND endpoint = 'https://fcm.googleapis.com/fcm/send/a1b2c3d4e5'
  ) THEN
    RAISE EXCEPTION 'T4-FAIL: a valid FCM endpoint was rejected';
  END IF;
  RAISE NOTICE 'T4-PASS: valid FCM endpoint accepted';

  -- T5: a real, valid Mozilla endpoint — must be accepted.
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (v_user, 'https://updates.push.services.mozilla.com/wpush/v2/abc123', 'p2', 'a2');
  IF NOT EXISTS (
    SELECT 1 FROM public.push_subscriptions
    WHERE user_id = v_user AND endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/abc123'
  ) THEN
    RAISE EXCEPTION 'T5-FAIL: a valid Mozilla endpoint was rejected';
  END IF;
  RAISE NOTICE 'T5-PASS: valid Mozilla endpoint accepted';

  -- T6: a real, valid Apple endpoint — must be accepted.
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (v_user, 'https://web.push.apple.com/v1/abc123', 'p3', 'a3');
  IF NOT EXISTS (
    SELECT 1 FROM public.push_subscriptions
    WHERE user_id = v_user AND endpoint = 'https://web.push.apple.com/v1/abc123'
  ) THEN
    RAISE EXCEPTION 'T6-FAIL: a valid Apple endpoint was rejected';
  END IF;
  RAISE NOTICE 'T6-PASS: valid Apple endpoint accepted';

  RAISE NOTICE 'ALL NKD-006 CHECK CONSTRAINT TESTS PASSED';
END $$;

ROLLBACK;
