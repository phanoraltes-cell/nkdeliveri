-- MonCash Client Checkout (Collect) — Phase 1. Client -> Platform only,
-- structurally separate from every decaissement table (payouts,
-- wallet_transactions, moncash_webhook_events, moncash_api_logs) — none
-- of those are touched by this migration. Reuses, unmodified:
--   - payments/payment_proofs (the existing manual-proof flow keeps
--     working exactly as before — a customer choosing "MonCash Automatik"
--     still gets a normal payments row, just handled by a different code
--     path that never touches submit_payment_proof_secure).
--   - trg_notify_payment_status (fires automatically once this migration's
--     RPCs update payments.status — no new notification code needed for
--     client "paiement confirmé/échoué" or restaurant "nouvo kòmand konfime").
--   - update_order_status_secure's existing payments.status='paid' gate
--     before a restaurant can confirm a moncash/natcash order.
--   - moncash-client.server.ts / moncashProvider (already implements
--     direction:"collect" — CreatePayment, checkStatus, verifyWebhook —
--     from the disbursement chantier, genuinely unused until now).

-- ---------------------------------------------------------------------------
-- 1) payment_transactions — the provider-level audit/lifecycle trail for
-- collect attempts. Distinct from moncash_api_logs (which already logs
-- every raw HTTP attempt generically, collect or disburse, and needs no
-- changes here) — this table is the *business* record linking an
-- order/payment to a MonCash transaction, not an HTTP log.
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'moncash_api',
  direction text NOT NULL DEFAULT 'collect' CHECK (direction = 'collect'),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  external_reference text NOT NULL,
  provider_transaction_id text,
  webhook_data jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_reference)
);
CREATE INDEX payment_transactions_order_id_idx ON public.payment_transactions(order_id);
CREATE INDEX payment_transactions_payment_id_idx ON public.payment_transactions(payment_id);
CREATE INDEX payment_transactions_created_at_idx ON public.payment_transactions(created_at DESC);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_transactions FROM PUBLIC, anon;

-- Admin: full visibility (audit). Customer: only their own (the order
-- detail page needs to tell "this MonCash payment is the automatic
-- collect flow" apart from the manual proof flow, and show live status)
-- — same shape as the existing "payments read" policy.
CREATE POLICY "payment_transactions admin read" ON public.payment_transactions FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "payment_transactions own read" ON public.payment_transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payment_transactions.order_id AND o.customer_id = auth.uid()));
GRANT SELECT ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;

-- ---------------------------------------------------------------------------
-- 2) create_collect_payment_secure — records a collect attempt. Called
-- by initiate-collect-payment.functions.ts *after* moncashProvider
-- .initiatePayment() has already run — never before, so this always
-- reflects a real provider outcome, never a frontend guess. Two shapes:
-- _status='pending' (provider accepted, redirect issued, webhook will
-- follow) or _status='failed' (provider rejected immediately — notifies
-- admin here since no webhook will ever arrive for this attempt).
CREATE FUNCTION public.create_collect_payment_secure(
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
REVOKE ALL ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) complete_collect_payment_secure — the *only* place a collect
-- payment_transactions row (and the payments row it belongs to) ever
-- moves to a terminal state. service_role-only: the webhook handler is
-- the sole caller, exactly mirroring complete/fail_pending_payout_secure
-- on the disbursement side. Idempotent by construction (UPDATE ... WHERE
-- status='pending' — a replayed webhook for an already-decided
-- transaction affects 0 rows, a safe no-op, never a double-notification).
CREATE FUNCTION public.complete_collect_payment_secure(
  _external_reference text,
  _decision text,
  _provider_transaction_id text DEFAULT NULL,
  _error text DEFAULT NULL,
  _webhook_data jsonb DEFAULT NULL
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
    updated_at = now()
  WHERE external_reference = _external_reference AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Either an unknown reference, or an already-decided one (replay --
    -- the row exists but status was no longer 'pending', so the WHERE
    -- above matched nothing). A genuinely missing row is a real error
    -- (a forged/garbled reference must never look like success); an
    -- already-decided row is returned as-is -- same outcome as last
    -- time, no side effect repeated, a normal idempotent no-op.
    SELECT * INTO v_row FROM public.payment_transactions WHERE external_reference = _external_reference;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Pa gen tranzaksyon peman pou referans sa a' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_row;
  END IF;

  -- The one write that matters for the rest of the app: flipping
  -- payments.status through a normal UPDATE fires trg_notify_payment_status
  -- exactly as the manual review flow already does — client and
  -- restaurant notifications for "paid"/"failed" require no new code.
  -- _decision is text; payments.status is the payment_status enum —
  -- Postgres does not implicitly cast a text *variable* (only unknown
  -- literals) to an enum, so this needs an explicit cast or the UPDATE
  -- fails at runtime with "column is of type payment_status but
  -- expression is of type text" (caught live via the Phase 2 BEGIN/
  -- ROLLBACK validation script, never previously exercised against a
  -- real database).
  UPDATE public.payments SET status = _decision::payment_status WHERE id = v_row.payment_id;

  PERFORM private.log_audit_event(NULL, 'system', 'collect_payment.' || _decision,
    jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id, 'amount', v_row.amount));

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
REVOKE ALL ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Realtime for the customer-facing "en atant / peye / echwe" status on
-- orders.$id.tsx — only `orders` was in the publication before; `orders
-- .status` doesn't reliably reflect payment progress on its own (it stays
-- 'pending' until the restaurant confirms, gated on payments.status='paid'
-- — see update_order_status_secure — and never changes at all on a
-- failed payment). complete_collect_payment_secure updates payments.status
-- in the same transaction as payment_transactions.status, so subscribing
-- to `payments` alone is sufficient to catch completion the moment it happens.
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
