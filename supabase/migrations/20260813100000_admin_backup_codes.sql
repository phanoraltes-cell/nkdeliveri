-- Admin backup/recovery codes — second, independent 2FA option alongside
-- TOTP (docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md). User request:
-- "add another possibility for admin to log in with a secret code besides
-- the scanned [TOTP] code." Confirmed live before writing this: pgcrypto
-- is already installed (SELECT extname FROM pg_extension -> present,
-- schema `extensions`), mfa_phone_enroll_enabled/mfa_web_authn_enroll_enabled
-- are both false project-wide (no SMS/WebAuthn infra to build on), and
-- there is no existing backup-code/PIN/OTP-by-email precedent anywhere in
-- this codebase — this is genuinely new, minimal, industry-standard
-- (GitHub/Google-style) surface.
--
-- Two decisions explicitly confirmed with the user before writing this:
--   1. Backup codes satisfy STANDARD step-up tier only (15 min — refund
--      review/complete). STRICT (5 min — role changes, payouts, payment
--      config) stays TOTP-only, no exception — a static, once-written
--      secret is a weaker independent factor than a 30-second rotating
--      code for the platform's highest-value actions.
--   2. Backup codes do NOT require TOTP to already be enrolled — this is a
--      fully independent second option, not a recovery mechanism gated
--      behind TOTP.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) admin_backup_codes — one row per issued code, hashed (bcrypt via
--    pgcrypto), single-use. Never plaintext once generate_admin_backup_
--    codes_secure() returns it. No direct grants at all -- SECURITY
--    DEFINER RPC access only, same posture as private.rate_limit_hits.
CREATE TABLE public.admin_backup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX admin_backup_codes_user_id_idx ON public.admin_backup_codes(user_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.admin_backup_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_backup_codes FROM PUBLIC, anon, authenticated;
-- Blocks DELETE/TRUNCATE only, not UPDATE -- used_at/revoked_at need to
-- transition in place, same carve-out this project already uses for
-- moncash_webhook_events (supabase/migrations/20260730130000_moncash_financial_audit_log.sql).
CREATE TRIGGER admin_backup_codes_no_delete
  BEFORE DELETE ON public.admin_backup_codes
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();
CREATE TRIGGER admin_backup_codes_no_truncate
  BEFORE TRUNCATE ON public.admin_backup_codes
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

-- ---------------------------------------------------------------------------
-- 2) admin_backup_code_state — one row per admin, mirrors what
--    auth.mfa_factors.last_challenged_at does for TOTP: the single
--    "when was this proof last used" timestamp private.admin_step_up_status()
--    reads. codes_remaining is a denormalized counter (kept in sync by the
--    two RPCs below) so the security page can show it without a second
--    query against admin_backup_codes.
CREATE TABLE public.admin_backup_code_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  codes_generated_at timestamptz,
  last_verified_at timestamptz,
  codes_remaining int NOT NULL DEFAULT 0
);
ALTER TABLE public.admin_backup_code_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_backup_code_state FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) generate_admin_backup_codes_secure — the only way to (re)issue codes.
--    Requires STANDARD step-up (a fresh sign-in is enough if no TOTP is
--    enrolled yet, matching every other STANDARD-tier action) -- generating
--    new codes is itself a sensitive action (it silently invalidates the
--    old ones), so it's gated exactly like review_refund_secure/
--    complete_refund_secure are.
CREATE OR REPLACE FUNCTION public.generate_admin_backup_codes_secure()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; -- Crockford Base32, no I/L/O/U -- exactly 32 chars, see loop comment below
  v_codes text[] := '{}';
  v_bytes bytea;
  v_code text;
  v_part text;
  i int;
  j int;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up();

  -- Revoke any previously-issued, still-unused codes -- regenerating means
  -- exactly one live set of codes ever exists per admin.
  UPDATE public.admin_backup_codes
  SET revoked_at = now()
  WHERE user_id = v_user AND used_at IS NULL AND revoked_at IS NULL;

  FOR i IN 1..10 LOOP
    -- extensions.gen_random_bytes() (pgcrypto) rather than plpgsql's
    -- built-in random() -- these are real single-use auth secrets, not UI
    -- randomness, and random() is not a CSPRNG. v_alphabet is exactly 32
    -- characters, so `byte % 32` maps each of the 256 possible byte values
    -- onto it with zero bias (256 is an exact multiple of 32).
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    FOR j IN 0..9 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, j) % 32) + 1, 1);
    END LOOP;
    v_part := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
    v_codes := array_append(v_codes, v_part);
    -- Hash the raw, undashed form (v_code) -- not the dash-formatted
    -- display string (v_part) -- so it matches verify_admin_backup_code_secure's
    -- normalization (which strips non-alphanumeric characters before
    -- comparing). The dash is purely a display/readability aid.
    INSERT INTO public.admin_backup_codes (user_id, code_hash)
    VALUES (v_user, extensions.crypt(v_code, extensions.gen_salt('bf')));
  END LOOP;

  INSERT INTO public.admin_backup_code_state (user_id, codes_generated_at, codes_remaining)
  VALUES (v_user, now(), 10)
  ON CONFLICT (user_id) DO UPDATE SET
    codes_generated_at = now(),
    codes_remaining = 10;

  PERFORM private.log_audit_event(v_user, private.get_primary_role(v_user),
    'admin_backup_codes_generated', jsonb_build_object('count', 10));

  RETURN v_codes;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_admin_backup_codes_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_admin_backup_codes_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) verify_admin_backup_code_secure — the only way to consume a code.
--    Rate-limited against brute-force guessing (same check_rate_limit_secure
--    RPC already used by initiate_payout_secure/submit_payment_proof_secure,
--    tighter window here since this is a "guess a secret" surface).
CREATE OR REPLACE FUNCTION public.verify_admin_backup_code_secure(_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_normalized text;
  v_row public.admin_backup_codes;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit_secure('admin_backup_code_verify', 5, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  -- A "wrong code" RETURNs false rather than RAISEs, deliberately --
  -- confirmed by direct testing (BEGIN/ROLLBACK) that RAISEing here
  -- defeats the rate limit above: PostgREST wraps each RPC call in one
  -- transaction, so an exception rolls back EVERYTHING that call did,
  -- including the check_rate_limit_secure hit it just recorded moments
  -- earlier in this same call (identical lesson to this migration's own
  -- audit-logging precedent, applied to rate-limiting instead). A wrong
  -- guess must still *commit* its own hit so repeated guesses actually
  -- accumulate toward the limit -- only a genuinely malformed/empty input,
  -- a role failure, or the limit itself being exceeded RAISE.
  v_normalized := upper(regexp_replace(COALESCE(_code, ''), '[^0-9A-Za-z]', '', 'g'));
  IF length(v_normalized) = 0 THEN
    RETURN false;
  END IF;

  SELECT bc.* INTO v_row
  FROM public.admin_backup_codes bc
  WHERE bc.user_id = v_user
    AND bc.used_at IS NULL
    AND bc.revoked_at IS NULL
    AND extensions.crypt(v_normalized, bc.code_hash) = bc.code_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.admin_backup_codes
  SET used_at = now()
  WHERE id = v_row.id AND used_at IS NULL;

  IF NOT FOUND THEN
    -- Lost a race against a concurrent use of the same code -- treat as invalid.
    RETURN false;
  END IF;

  UPDATE public.admin_backup_code_state
  SET last_verified_at = now(),
      codes_remaining = GREATEST(codes_remaining - 1, 0)
  WHERE user_id = v_user;

  PERFORM private.log_audit_event(v_user, private.get_primary_role(v_user),
    'admin_backup_code_used',
    (SELECT jsonb_build_object('codes_remaining', codes_remaining)
     FROM public.admin_backup_code_state WHERE user_id = v_user));

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_admin_backup_code_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_backup_code_secure(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) get_admin_backup_codes_status_secure — read-only, self only, never
--    exposes code_hash. Powers the "N codes remaining" display.
CREATE OR REPLACE FUNCTION public.get_admin_backup_codes_status_secure()
RETURNS TABLE (
  codes_remaining int,
  generated_at timestamptz,
  last_used_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(s.codes_remaining, 0),
    s.codes_generated_at,
    s.last_verified_at
  FROM (SELECT 1) AS one
  LEFT JOIN public.admin_backup_code_state s ON s.user_id = auth.uid()
  WHERE (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
$$;
REVOKE ALL ON FUNCTION public.get_admin_backup_codes_status_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_backup_codes_status_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Patch private.admin_step_up_status() -- add backup-code freshness as a
--    third, independent proof path, reachable only when _allow_fallback is
--    true (i.e. never for require_admin_step_up_strict(), which always
--    passes _allow_fallback=false -- backup codes structurally cannot
--    satisfy STRICT no matter how fresh the verification is). Full body
--    reproduced from supabase/migrations/20260811120000_admin_step_up_enforcement.sql,
--    unchanged except for the one new IF block inserted between the
--    existing TOTP branch and the existing "no factor enrolled" fallback
--    branch below it.
CREATE OR REPLACE FUNCTION private.admin_step_up_status(_max_age interval, _allow_fallback boolean)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session_id uuid;
  v_has_verified_factor boolean;
  v_latest_challenge timestamptz;
  v_latest_backup_use timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RETURN 'missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_factors WHERE user_id = v_user AND status = 'verified'
  ) INTO v_has_verified_factor;

  IF v_has_verified_factor THEN
    SELECT max(last_challenged_at) INTO v_latest_challenge
    FROM auth.mfa_factors WHERE user_id = v_user AND status = 'verified';

    IF (auth.jwt() ->> 'aal') = 'aal2' AND v_latest_challenge IS NOT NULL THEN
      IF v_latest_challenge > now() - _max_age THEN
        RETURN 'ok';
      ELSE
        RETURN 'expired';
      END IF;
    END IF;
    -- Has a factor, but this session never verified it via TOTP -- still
    -- worth checking the backup-code path below (an admin with TOTP
    -- enrolled can still choose to unlock with a backup code) before
    -- falling through to 'missing'.
  END IF;

  -- NEW: backup-code freshness. Independent of whether a TOTP factor
  -- exists (backup codes are a standalone second option, not a recovery
  -- path gated behind TOTP) -- but only ever reachable when _allow_fallback
  -- is true, so this can never satisfy the STRICT tier.
  IF _allow_fallback THEN
    SELECT last_verified_at INTO v_latest_backup_use
    FROM public.admin_backup_code_state WHERE user_id = v_user;
    IF v_latest_backup_use IS NOT NULL AND v_latest_backup_use > now() - _max_age THEN
      RETURN 'ok';
    END IF;
  END IF;

  IF v_has_verified_factor THEN
    RETURN 'missing'; -- has a factor, but neither TOTP nor a fresh backup code satisfied this session
  END IF;

  IF NOT _allow_fallback THEN
    RETURN 'missing';
  END IF;

  -- Fallback: no MFA factor enrolled anywhere on this account yet, and no
  -- fresh backup-code use either. Proof is "the CURRENT session was itself
  -- created (not just refreshed) very recently" -- signInWithPassword/
  -- signInWithOAuth always mint a new auth.sessions row, refreshing an
  -- existing token never does.
  BEGIN
    v_session_id := (auth.jwt() ->> 'session_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_session_id := NULL;
  END;
  IF v_session_id IS NULL THEN
    RETURN 'missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_user AND s.created_at > now() - _max_age
  ) THEN
    RETURN 'ok';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = v_session_id AND s.user_id = v_user) THEN
    RETURN 'expired';
  END IF;

  RETURN 'missing';
END;
$$;
REVOKE ALL ON FUNCTION private.admin_step_up_status(interval, boolean) FROM PUBLIC, anon, authenticated;
