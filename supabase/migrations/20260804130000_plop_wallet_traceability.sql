-- PLOP dynamic wallet selection — traceability (Phase 1 remediation,
-- docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 7 Option A + this phase's
-- mission). The actual bug fixed by this chantier —
-- plop-client.server.ts's createPayment() reading `payment_method` from a
-- single global env var (PLOP_PAYMENT_METHOD) instead of accepting it per
-- call — is a pure application-code fix requiring NO schema change on its
-- own. This migration only adds the traceability layer requested
-- alongside it: recording what wallet was *requested* at creation and
-- what wallet PLOP says was *used* at confirmation (PLOP's own `method`
-- field on `paiement-verify`, previously discarded — audit § 4.3).
--
-- Purely additive: two new nullable columns, no data migration (existing
-- rows simply have NULL for both — "unknown, created before this
-- migration", never guessed). NOT applied automatically per this phase's
-- explicit instruction — written and versioned here, applied by hand
-- after review, same convention as every other migration in this project.

ALTER TABLE public.payment_transactions
  ADD COLUMN payment_method_requested text,
  ADD COLUMN payment_method_used text;

-- ---------------------------------------------------------------------------
-- create_collect_payment_secure — signature change (new trailing optional
-- parameter). DROP FUNCTION IF EXISTS before CREATE OR REPLACE is
-- mandatory here, never optional: a CREATE OR REPLACE with a different
-- argument list creates a silent second overload instead of replacing the
-- function — the exact hazard docs/reference/MIGRATIONS.md documents and
-- scripts/check-migration-hazards.mjs guards against.
--
-- SECURITY REMEDIATION (docs/archive/plop/PLOP_DYNAMIC_WALLET_PHASE1_VALIDATION_REPORT.md):
-- this function has TWO prior definitions, not one —
-- 20260731130000_moncash_collect_payments.sql (original) AND
-- 20260803130000_harden_create_collect_payment_provider_check.sql (adds the
-- "refuse a fabricated pending row while moncash_auto is disabled" check,
-- currently live in production). The first version of this migration
-- rebuilt the function from the *original* body only, silently dropping
-- that hardening — caught by an independent validation audit before this
-- migration was ever applied. The body below is a merge of both: the
-- 08-03 hardening block (reproduced verbatim, same position — immediately
-- before the INSERT) + this phase's own payment_method_requested
-- parameter/column. Every other line matches both prior versions exactly.
DROP FUNCTION IF EXISTS public.create_collect_payment_secure(uuid, text, text, text);

CREATE FUNCTION public.create_collect_payment_secure(
  _payment_id uuid,
  _external_reference text,
  _status text DEFAULT 'pending',
  _error text DEFAULT NULL,
  _payment_method_requested text DEFAULT NULL
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

  -- Restored from 20260803130000_harden_create_collect_payment_provider_check.sql
  -- (same position, same condition, same message — a pending row asserts
  -- that a real attempt was actually made against MonCash; refuse to
  -- fabricate that claim if the provider is disabled, regardless of what
  -- called this RPC or how — closes the direct-RPC-call bypass scenario
  -- independent of initiate-collect-payment.logic.ts's own enabled check).
  -- A `failed` row carries no such claim, so it is not gated here.
  IF _status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_provider_settings
      WHERE provider = 'moncash_auto' AND enabled = true
    ) THEN
      RAISE EXCEPTION 'MonCash Automatik pa disponib pou kounye a.' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.payment_transactions
    (order_id, payment_id, amount, status, external_reference, error, payment_method_requested)
  VALUES
    (v_payment.order_id, _payment_id, v_payment.amount, _status, _external_reference, _error, _payment_method_requested)
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'customer', 'collect_payment.created',
    jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id, 'status', _status,
      'payment_method_requested', _payment_method_requested));

  IF _status = 'failed' THEN
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
REVOKE ALL ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_collect_payment_secure — same DROP-before-CREATE discipline,
-- same reasoning. Body otherwise identical to the original migration —
-- only the new parameter and its use in the UPDATE are added.
DROP FUNCTION IF EXISTS public.complete_collect_payment_secure(text, text, text, text, jsonb);

CREATE FUNCTION public.complete_collect_payment_secure(
  _external_reference text,
  _decision text,
  _provider_transaction_id text DEFAULT NULL,
  _error text DEFAULT NULL,
  _webhook_data jsonb DEFAULT NULL,
  _payment_method_used text DEFAULT NULL
)
RETURNS public.payment_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payment_transactions;
BEGIN
  IF _decision NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Desizyon envalid';
  END IF;

  UPDATE public.payment_transactions SET
    status = _decision,
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    error = _error,
    webhook_data = COALESCE(_webhook_data, webhook_data),
    payment_method_used = COALESCE(_payment_method_used, payment_method_used),
    updated_at = now()
  WHERE external_reference = _external_reference AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Either an unknown reference, or an already-decided one (replay --
    -- the row exists but status was no longer 'pending', so the WHERE
    -- above matched nothing). Unchanged from the original migration.
    SELECT * INTO v_row FROM public.payment_transactions WHERE external_reference = _external_reference;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Pa gen tranzaksyon peman pou referans sa a' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.payments SET status = _decision::payment_status WHERE id = v_row.payment_id;

  PERFORM private.log_audit_event(NULL, 'system', 'collect_payment.' || _decision,
    jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id, 'amount', v_row.amount,
      'payment_method_used', _payment_method_used));

  IF _decision = 'failed' THEN
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'collect_payment_admin_error', 'payment',
      'Peman kliyan echwe',
      'Yon peman kliyan ' || v_row.amount || ' HTG atravè MonCash Automatik echwe: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) TO service_role;
