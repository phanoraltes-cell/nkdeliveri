-- Payment Provider Hardening — Phase 5. Closes a real, low-severity gap
-- found while verifying the "appel RPC direct" attack scenario the
-- mission explicitly names: create_collect_payment_secure had no
-- awareness of payment_provider_settings at all, so a client calling it
-- directly (bypassing initiate-collect-payment.logic.ts's new `enabled`
-- check entirely) could still insert a `pending` payment_transactions row
-- while MonCash Automatik is disabled.
--
-- No financial impact either way — this RPC never touches `payments`/
-- `orders`, only `complete_collect_payment_secure` (service_role-only,
-- unreachable by any client) can ever mark a payment paid — but the
-- mission is explicit that the backend must refuse *every* direct
-- avenue, not just the orchestrated one, so this closes it anyway.
--
-- CREATE OR REPLACE preserves the function's existing REVOKE/GRANT
-- (attached to its name+signature, unchanged here) — no new REVOKE/GRANT
-- needed. Every other line of the function body is reproduced verbatim
-- from the original (20260731130000_moncash_collect_payments.sql); only
-- one new IF block is added, immediately before the INSERT.
CREATE OR REPLACE FUNCTION public.create_collect_payment_secure(
  _payment_id uuid,
  _external_reference text,
  _status text DEFAULT 'pending',
  _error text DEFAULT NULL
)
RETURNS public.payment_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_payment public.payments;
  v_row public.payment_transactions;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'Estati envalid';
  END IF;
  IF NOT public.check_rate_limit_secure('create_collect_payment', 10, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE p.id = _payment_id AND o.customer_id = v_user
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '42501';
  END IF;
  IF v_payment.method <> 'moncash' THEN
    RAISE EXCEPTION 'MonCash Automatik disponib sèlman pou peman MonCash';
  END IF;
  IF v_payment.status NOT IN ('awaiting_proof', 'pending') THEN
    RAISE EXCEPTION 'Peman sa a deja an kou trete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE payment_id = _payment_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Yon tantativ peman deja an kou pou kòmand sa a';
  END IF;

  -- New: a `pending` row asserts that a real attempt was actually made
  -- (or is in flight) against MonCash — refuse to fabricate that claim
  -- if the provider is disabled, regardless of what called this RPC or
  -- how. A `failed` row carries no such claim (it's exactly what the
  -- legitimate disabled-provider refusal in
  -- initiate-collect-payment.logic.ts itself records), so it is not
  -- gated here — blocking it would break that call site's own logging.
  IF _status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_provider_settings
      WHERE provider = 'moncash_auto' AND enabled = true
    ) THEN
      RAISE EXCEPTION 'MonCash Automatik pa disponib pou kounye a.' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.payment_transactions (order_id, payment_id, amount, status, external_reference, error)
  VALUES (v_payment.order_id, _payment_id, v_payment.amount, _status, _external_reference, _error)
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'customer', 'collect_payment.created',
    jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id, 'status', _status));

  IF _status = 'failed' THEN
    -- No webhook will ever arrive for an attempt MonCash rejected
    -- immediately — this is the only chance to tell an admin.
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'collect_payment_admin_error', 'payment',
      'Tantativ peman kliyan echwe',
      'Yon tantativ peman MonCash Automatik ' || v_payment.amount || ' HTG echwe imedyatman: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
