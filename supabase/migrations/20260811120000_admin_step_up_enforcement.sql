-- Admin dashboard step-up/MFA enforcement (Phase 2 of
-- docs/archive/audits/ADMIN_ACCESS_SECURITY_AUDIT.md). Fixes the exact gap the audit
-- found: src/hooks/useReauth.ts already asks an admin to re-enter their
-- password/OAuth before a sensitive action, but NONE of the RPC it wraps
-- (add_user_role_secure, remove_user_role_secure, initiate_payout_secure,
-- review_refund_secure, complete_refund_secure) ever checked that proof
-- server-side — a stolen session's JWT could call any of them directly
-- (DevTools/curl) and succeed, the ReauthDialog is purely a frontend
-- courtesy today. This migration makes the proof real and
-- server-verified, using only Supabase's own native Auth schema — no
-- custom crypto, no new "is this a real re-auth" table to invent and keep
-- in sync:
--
--   1. Real MFA (TOTP, already enabled project-wide —
--      mfa_totp_enroll_enabled/verify_enabled: true, confirmed live,
--      zero Supabase Dashboard config change needed): once an admin
--      completes supabase.auth.mfa.challengeAndVerify(), GoTrue itself
--      issues a new JWT carrying `aal: "aal2"` and stamps
--      auth.mfa_factors.last_challenged_at — both read directly here via
--      auth.jwt() and a plain SELECT, no client input trusted at any
--      point.
--   2. Fallback for the (today, exactly one) admin account with no TOTP
--      factor enrolled yet: signInWithPassword/signInWithOAuth
--      (ReauthDialog's existing flow, untouched) always mints a brand
--      new row in auth.sessions — its own created_at, written by GoTrue,
--      is the freshness proof, read via auth.sessions keyed off the
--      current JWT's `session_id` claim. Still 100% server-truth, still
--      zero new tables.
--
-- Two tiers, scoped by actually reading every admin-role-checking RPC in
-- this project (47 found, see docs/archive/audits/ADMIN_ACCESS_SECURITY_AUDIT.md's
-- companion remediation report for the full inventory) rather than
-- guessing which ones "feel" sensitive:
--
--   STRICT (5 min, TOTP only, fallback rejected) — modifies admin/
--   super_admin privileges, moves real money out of the platform, or
--   changes global payment-security configuration:
--     add_user_role_secure, remove_user_role_secure,
--     initiate_payout_secure, update_payment_provider_setting_secure,
--     update_platform_payout_settings_secure
--
--   STANDARD (15 min, fallback allowed) — the 2 remaining actions
--   src/hooks/useReauth.ts already wraps, each with its own approval
--   workflow upstream (a refund only reaches these once already
--   'requested'/'approved'):
--     review_refund_secure, complete_refund_secure
--
-- Every other admin-role-checking RPC (~40, mostly the get_*_admin
-- read-only queries) is deliberately left untouched here — Tier 0
-- ("can this session even reach the admin dashboard at all") stays a
-- frontend gate (dashboard.admin.tsx, unchanged pattern from
-- requireRole()), same posture the project already accepts for role
-- checks in general (RLS is the real boundary for reads; nothing about
-- who can read what changes in this migration). Documented as a
-- deliberate scope decision, not an oversight — expanding STRICT/STANDARD
-- coverage to more RPCs is a proportionate follow-up, not bundled into
-- this migration to keep its blast radius reviewable.

-- ---------------------------------------------------------------------------
-- 1) Core status function — single source of truth, everything else below
--    calls this. Returns 'ok' | 'expired' | 'missing' (not just boolean)
--    so callers can log a meaningful reason without re-deriving it.
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
BEGIN
  IF v_user IS NULL THEN
    RETURN 'missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_factors WHERE user_id = v_user AND status = 'verified'
  ) INTO v_has_verified_factor;

  IF v_has_verified_factor THEN
    -- A factor exists for this account -- MFA is mandatory for this user,
    -- the password/OAuth fallback below never applies to them regardless
    -- of _allow_fallback, matching "critical ops need fresh MFA, not a
    -- weaker substitute" for STRICT, and simply "use the real factor you
    -- already have" for STANDARD.
    SELECT max(last_challenged_at) INTO v_latest_challenge
    FROM auth.mfa_factors WHERE user_id = v_user AND status = 'verified';

    IF (auth.jwt() ->> 'aal') = 'aal2' AND v_latest_challenge IS NOT NULL THEN
      IF v_latest_challenge > now() - _max_age THEN
        RETURN 'ok';
      ELSE
        RETURN 'expired';
      END IF;
    END IF;
    RETURN 'missing'; -- has a factor, but this session never verified it
  END IF;

  IF NOT _allow_fallback THEN
    RETURN 'missing';
  END IF;

  -- Fallback: no MFA factor enrolled anywhere on this account yet. Proof
  -- is "the CURRENT session was itself created (not just refreshed) very
  -- recently" -- signInWithPassword/signInWithOAuth always mint a new
  -- auth.sessions row, refreshing an existing token never does.
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

CREATE OR REPLACE FUNCTION private.admin_step_up_ok(_max_age interval, _allow_fallback boolean DEFAULT true)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.admin_step_up_status(_max_age, _allow_fallback) = 'ok';
$$;
REVOKE ALL ON FUNCTION private.admin_step_up_ok(interval, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Enforcement helpers -- one line, `PERFORM private.require_admin_step_up[_strict]();`,
--    added to each guarded RPC right after its existing has_role check.
--    RAISE, never a boolean return -- matches this project's existing
--    "Forbidden" convention (every RPC in this codebase already RAISEs on
--    denial rather than returning a sentinel), so callers only need one
--    new error-message pattern to recognize instead of a new response
--    shape.
--
--    Deliberately do NOT call private.log_audit_event() from inside these
--    two functions on the failure path -- confirmed by a real BEGIN/
--    ROLLBACK test while building this migration that it's a no-op:
--    PostgREST runs each RPC call as one transaction, and an uncaught
--    RAISE EXCEPTION aborts that whole transaction, silently undoing any
--    INSERT (including into audit_log) made earlier in the same call. A
--    write that only "succeeds" until the very statement that discards it
--    isn't a real audit trail. The actual logging happens from a
--    *separate* RPC call the frontend makes after catching the error
--    (public.log_admin_step_up_event_secure below) -- its own independent
--    transaction, so it commits regardless of the first call's rollback.
CREATE OR REPLACE FUNCTION private.require_admin_step_up()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF private.admin_step_up_status(interval '15 minutes', true) <> 'ok' THEN
    RAISE EXCEPTION 'STEP_UP_REQUIRED: Verifikasyon sekirite adisyonèl obligatwa pou aksyon sa a.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.require_admin_step_up() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.require_admin_step_up_strict()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 5 min, no fallback: a critical op always requires a genuine, recent
  -- MFA challenge -- an account with no TOTP factor enrolled cannot pass
  -- this tier at all (by design, see migration header) until they enroll.
  IF private.admin_step_up_status(interval '5 minutes', false) <> 'ok' THEN
    RAISE EXCEPTION 'STEP_UP_REQUIRED_MFA: Verifikasyon MFA fre obligatwa pou aksyon sa a.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.require_admin_step_up_strict() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Public-facing RPCs the frontend actually calls.
CREATE OR REPLACE FUNCTION public.check_admin_step_up_secure()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.admin_step_up_ok(interval '15 minutes', true);
$$;
REVOKE ALL ON FUNCTION public.check_admin_step_up_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_admin_step_up_secure() TO authenticated;

-- Frontend-triggered audit telemetry -- never the security decision
-- itself (that's always require_admin_step_up[_strict](), evaluated
-- independently inside each guarded RPC, and it cannot be influenced by
-- what gets logged here). Allowlisted _action so this can't be abused to
-- write arbitrary audit_log rows.
--
-- 'admin_step_up_failed'/'admin_step_up_expired' are called from here,
-- by the frontend, specifically *because* logging them from inside
-- require_admin_step_up[_strict]() doesn't work -- see that function's
-- own comment: a RAISE EXCEPTION rolls back everything written earlier
-- in the same PostgREST transaction, including an audit_log INSERT. This
-- call is the caller's own, separate transaction, made after the
-- protected RPC's call already failed and rolled back, so it survives.
CREATE OR REPLACE FUNCTION public.log_admin_step_up_event_secure(_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN (
    'admin_step_up_started', 'admin_step_up_success',
    'admin_step_up_failed', 'admin_step_up_expired'
  ) THEN
    RAISE EXCEPTION 'Invalid event' USING ERRCODE = '22023';
  END IF;
  PERFORM private.log_audit_event(auth.uid(), private.get_primary_role(auth.uid()), _action, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.log_admin_step_up_event_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_step_up_event_secure(text) TO authenticated;

-- Callable by any authenticated user (not just admins) -- this is the one
-- that fires precisely when someone is NOT an admin/super_admin and
-- requireRole() bounces them, so it can't itself require that role.
-- Self-attributed only (auth.uid()), can't be used to log on someone
-- else's behalf.
CREATE OR REPLACE FUNCTION public.log_dashboard_access_denied_secure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  PERFORM private.log_audit_event(
    auth.uid(), private.get_primary_role(auth.uid()), 'admin_dashboard_access_denied', '{}'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_dashboard_access_denied_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_dashboard_access_denied_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Wire enforcement into the 5 STRICT-tier RPCs. Full bodies reproduced
--    (CREATE OR REPLACE requires it) -- every line below the added
--    PERFORM is byte-identical to the live function, confirmed by diffing
--    against pg_get_functiondef() before writing this migration, not
--    retyped from memory.

CREATE OR REPLACE FUNCTION public.add_user_role_secure(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();
  IF _role IN ('admin', 'super_admin') AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Sèl yon super_admin ka bay wòl admin' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_user_role_secure(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();
  IF _role IN ('admin', 'super_admin') AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Sèl yon super_admin ka retire wòl admin' USING ERRCODE = '42501';
  END IF;
  IF _user_id = auth.uid() AND _role IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Ou pa ka retire pwòp wòl admin ou';
  END IF;
  IF _role = 'super_admin' AND (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'Dwe gen omwen yon super_admin sou platfòm nan';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_platform_payout_settings_secure(_moncash_number text, _moncash_account_name text, _natcash_number text, _natcash_account_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();

  UPDATE public.platform_payout_settings
  SET moncash_number = _moncash_number,
      moncash_account_name = _moncash_account_name,
      natcash_number = _natcash_number,
      natcash_account_name = _natcash_account_name,
      updated_at = now()
  WHERE id = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_payment_provider_setting_secure(_provider text, _visible boolean DEFAULT NULL::boolean, _enabled boolean DEFAULT NULL::boolean, _maintenance_message text DEFAULT NULL::text, _set_as_default boolean DEFAULT NULL::boolean)
RETURNS payment_provider_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payment_provider_settings;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();

  -- Unset any existing default *before* the main UPDATE below, so a
  -- caller can move the default from one provider to another in a
  -- single RPC call without ever hitting the partial unique index twice
  -- for the same provider.
  IF _set_as_default IS TRUE THEN
    UPDATE public.payment_provider_settings
    SET default_provider = false, updated_by = v_user, updated_at = now()
    WHERE default_provider = true AND provider <> _provider;
  END IF;

  UPDATE public.payment_provider_settings SET
    visible = COALESCE(_visible, visible),
    enabled = COALESCE(_enabled, enabled),
    maintenance_message = CASE
      WHEN _maintenance_message IS NULL THEN maintenance_message
      ELSE NULLIF(_maintenance_message, '')
    END,
    default_provider = COALESCE(_set_as_default, default_provider),
    updated_by = v_user,
    updated_at = now()
  WHERE provider = _provider
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment provider: %', _provider USING ERRCODE = 'P0002';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payment_provider_setting.updated',
    jsonb_build_object(
      'provider', _provider,
      'visible', v_row.visible,
      'enabled', v_row.enabled,
      'default_provider', v_row.default_provider,
      'maintenance_message', v_row.maintenance_message
    ));

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.initiate_payout_secure(_restaurant_id uuid DEFAULT NULL::uuid, _driver_id uuid DEFAULT NULL::uuid, _amount numeric DEFAULT NULL::numeric, _method text DEFAULT NULL::text, _transaction_reference text DEFAULT NULL::text, _proof_url text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _provider_code text DEFAULT 'manual'::text)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_receiver_number text;
  v_receiver_account text;
  v_beneficiary_user uuid;
  v_row public.payouts;
  v_remaining numeric;
  v_link_amount numeric;
  v_commission record;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Montan envalid';
  END IF;
  IF _method IS NULL OR NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = _method AND is_active) THEN
    RAISE EXCEPTION 'Chwazi yon metòd peman valid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_providers WHERE code = _provider_code AND is_active) THEN
    RAISE EXCEPTION 'Pwovidè peman sa a pa disponib';
  END IF;
  IF _transaction_reference IS NULL OR length(btrim(_transaction_reference)) = 0 THEN
    RAISE EXCEPTION 'Referans tranzaksyon obligatwa';
  END IF;
  IF NOT public.check_rate_limit_secure('initiate_payout', 30, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE restaurant_id = _restaurant_id FOR UPDATE;
  ELSE
    SELECT * INTO v_wallet FROM public.wallets WHERE driver_id = _driver_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR v_wallet.available_balance < _amount THEN
    RAISE EXCEPTION 'Balans disponib la pa ase';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = _restaurant_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    ELSE
      SELECT natcash_number, natcash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    END IF;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = _driver_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.drivers WHERE id = _driver_id;
    ELSE
      SELECT natcash_number, natcash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.drivers WHERE id = _driver_id;
    END IF;
  END IF;
  IF v_receiver_number IS NULL THEN
    RAISE EXCEPTION 'Benefisyè a poko konfigire nimewo peman sa a';
  END IF;

  UPDATE public.wallets SET
    available_balance = available_balance - _amount,
    pending_balance = pending_balance + _amount,
    updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.payouts (
    restaurant_id, driver_id, wallet_id, amount, method, receiver_number, receiver_account_name,
    transaction_reference, proof_url, status, admin_notes, paid_by, status_history, provider_code
  )
  VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    btrim(_transaction_reference), _proof_url, 'paid', NULLIF(btrim(_notes), ''), v_user,
    jsonb_build_array(jsonb_build_object('to', 'paid', 'by', v_user, 'at', now())), _provider_code
  )
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_wallet.id, 'payout_sent', -_amount, _amount, v_row.id, v_user, 'Peman voye');

  IF v_beneficiary_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_beneficiary_user, 'payout_paid', 'Ou resevwa yon peman',
      'Ou resevwa yon peman ' || _amount || ' HTG. Tanpri konfime resepsyon an.',
      jsonb_build_object('payout_id', v_row.id, 'amount', _amount));
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.created',
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id, 'provider_code', _provider_code));
  PERFORM private.log_audit_event(v_user, 'admin', 'wallet.debited',
    jsonb_build_object('wallet_id', v_wallet.id, 'amount', _amount, 'payout_id', v_row.id));

  -- Link outstanding commissions to this payout for traceability, oldest
  -- first, up to the paid amount. Unchanged from the perf-fix version.
  v_remaining := _amount;
  FOR v_commission IN
    SELECT cl.id, cl.net_amount - COALESCE(pc_sum.covered, 0) AS outstanding
    FROM public.commission_ledger cl
    LEFT JOIN LATERAL (
      SELECT sum(pc.covered_amount) AS covered
      FROM public.payout_commissions pc
      WHERE pc.commission_ledger_id = cl.id
    ) pc_sum ON true
    WHERE cl.entry_type = 'order_commission'
      AND cl.net_amount > 0
      AND COALESCE(pc_sum.covered, 0) < cl.net_amount
      AND ((_restaurant_id IS NOT NULL AND cl.restaurant_id = _restaurant_id)
        OR (_driver_id IS NOT NULL AND cl.driver_id = _driver_id))
    ORDER BY cl.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_link_amount := LEAST(v_commission.outstanding, v_remaining);
    INSERT INTO public.payout_commissions (payout_id, commission_ledger_id, covered_amount)
    VALUES (v_row.id, v_commission.id, v_link_amount);
    v_remaining := v_remaining - v_link_amount;
  END LOOP;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Wire enforcement into the 2 STANDARD-tier RPCs (15 min, fallback ok).

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
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
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

CREATE OR REPLACE FUNCTION public.complete_refund_secure(_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
  v_order_status public.order_status;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up();

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

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id, 'refund_completed', 'Ranbousman trete',
    'Lajan pou kòmand ou an ranbouse.',
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$function$;
