-- Stripe Collect integration (credit card checkout method,
-- docs/STRIPE_INTEGRATION_REPORT.md). Collect only — no card-based
-- decaissement/payout exists in this app, and this migration touches
-- nothing on that side. Real Stripe credentials are added later
-- (STRIPE_SECRET_KEY/STRIPE_PUBLISHABLE_KEY/STRIPE_WEBHOOK_SECRET/
-- STRIPE_HTG_CONVERSION_RATE) — `stripe_auto`'s row below ships disabled,
-- same caution `moncash_auto`/`natcash_auto` originally shipped with.

-- ---------------------------------------------------------------------------
-- 1) stripe_api_logs — API call audit log, schema matrix-matched
-- field-for-field to plop_api_logs/moncash_api_logs so
-- Dashboard/Monitoring/KPI/Alertes queries written against one work
-- unmodified against the others, just by swapping the table name.
CREATE TABLE public.stripe_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  attempt int NOT NULL DEFAULT 1,
  http_status int,
  duration_ms int NOT NULL,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb,
  error text,
  is_timeout boolean NOT NULL DEFAULT false,
  transaction_reference text,
  provider_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stripe_api_logs_created_at_idx ON public.stripe_api_logs(created_at DESC);
CREATE INDEX stripe_api_logs_transaction_reference_idx ON public.stripe_api_logs(transaction_reference);
CREATE INDEX stripe_api_logs_endpoint_idx ON public.stripe_api_logs(endpoint);

ALTER TABLE public.stripe_api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_api_logs admin read" ON public.stripe_api_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.stripe_api_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stripe_api_logs TO authenticated;
GRANT SELECT, INSERT ON public.stripe_api_logs TO service_role;

-- Append-only enforcement, reusing the trigger function already created
-- by 20260730130000_moncash_financial_audit_log.sql — never a second copy
-- of the same guard logic for a third audit table.
CREATE TRIGGER stripe_api_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON public.stripe_api_logs
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();

CREATE TRIGGER stripe_api_logs_no_truncate
  BEFORE TRUNCATE ON public.stripe_api_logs
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

-- ---------------------------------------------------------------------------
-- 2) Seed the "Kat Kredi" checkout method's settings row — disabled by
-- default, same convention moncash_auto/natcash_auto both shipped with.
-- `provider` is free-text/UNIQUE, no schema change needed for a new value.
INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider, maintenance_message) VALUES
  ('stripe', true, false, false, 'Peman ak kat kredi ap disponib byento.');

-- ---------------------------------------------------------------------------
-- 3) create_collect_payment_secure — signature change (new trailing
-- `_provider_transaction_id` param, needed because Stripe's Checkout
-- Session id only exists after Stripe creates it and must be persisted
-- immediately for later lookup — Stripe has no "find my session by my
-- own reference" endpoint, docs/STRIPE_INTEGRATION_REPORT.md,
-- stripe-provider.server.ts's own header comment). DROP-before-CREATE is
-- mandatory here (signature changed), per this project's own convention
-- and scripts/check-migration-hazards.mjs.
--
-- Also generalizes the method allowlist and provider-settings gate to
-- include 'stripe' (same v_provider_key/v_provider_label pattern
-- 20260805120000 introduced for natcash_auto), and records `provider` =
-- 'stripe_api' vs 'moncash_api' explicitly (previously always relied on
-- the column's own DEFAULT 'moncash_api', which stays correct for
-- moncash/natcash unchanged — only stripe genuinely differs).
DROP FUNCTION IF EXISTS public.create_collect_payment_secure(uuid, text, text, text, text);

CREATE FUNCTION public.create_collect_payment_secure(
  _payment_id uuid,
  _external_reference text,
  _status text DEFAULT 'pending',
  _error text DEFAULT NULL,
  _payment_method_requested text DEFAULT NULL,
  _provider_transaction_id text DEFAULT NULL
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
  v_provider_key text;
  v_provider_label text;
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
  IF v_payment.method NOT IN ('moncash', 'natcash', 'stripe') THEN
    RAISE EXCEPTION 'Peman otomatik disponib sèlman pou MonCash, NatCash, oswa Kat Kredi';
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

  -- MonCash Otomatik, NatCash Otomatik, and Kat Kredi are three
  -- independent checkout buttons — each gated by its OWN
  -- payment_provider_settings row, never a single shared one
  -- (docs/PLOP_NATCASH_INTEGRATION_PLAN.md § 2.5, the same class of bug
  -- fixed there, extended here to cover the third method).
  v_provider_key := CASE
    WHEN v_payment.method = 'natcash' THEN 'natcash_auto'
    WHEN v_payment.method = 'stripe' THEN 'stripe'
    ELSE 'moncash_auto'
  END;
  v_provider_label := CASE
    WHEN v_payment.method = 'natcash' THEN 'NatCash Otomatik'
    WHEN v_payment.method = 'stripe' THEN 'Kat Kredi'
    ELSE 'MonCash Otomatik'
  END;

  -- Originally restored from 20260803130000_harden_create_collect_payment_provider_check.sql
  -- — a pending row asserts that a real attempt was actually made against
  -- the provider; refuse to fabricate that claim if it's disabled,
  -- regardless of what called this RPC or how. A `failed` row carries no
  -- such claim, so it is not gated here.
  IF _status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_provider_settings
      WHERE provider = v_provider_key AND enabled = true
    ) THEN
      RAISE EXCEPTION '% pa disponib pou kounye a.', v_provider_label USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.payment_transactions
    (order_id, payment_id, amount, status, external_reference, error, payment_method_requested, provider, provider_transaction_id)
  VALUES
    (v_payment.order_id, _payment_id, v_payment.amount, _status, _external_reference, _error, _payment_method_requested,
     CASE WHEN v_payment.method = 'stripe' THEN 'stripe_api' ELSE 'moncash_api' END,
     _provider_transaction_id)
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'customer', 'collect_payment.created',
    jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id, 'status', _status,
      'payment_method_requested', _payment_method_requested));

  IF _status = 'failed' THEN
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'collect_payment_admin_error', 'payment',
      'Tantativ peman kliyan echwe',
      'Yon tantativ peman ' || v_provider_label || ' ' || v_payment.amount || ' HTG echwe imedyatman: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) complete_collect_payment_secure — signature UNCHANGED (CREATE OR
-- REPLACE is safe, confirmed by scripts/check-migration-hazards.mjs).
-- Only the admin notification body's wallet-label CASE is extended to
-- recognize 'stripe' — previously only distinguished natcash from
-- everything else (implicitly moncash), which would have mislabeled a
-- failed Stripe payment as "MonCash Otomatik".
CREATE OR REPLACE FUNCTION public.complete_collect_payment_secure(
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
      'Yon peman kliyan ' || v_row.amount || ' HTG atravè ' ||
        (CASE
          WHEN v_row.payment_method_requested = 'natcash' THEN 'NatCash Otomatik'
          WHEN v_row.payment_method_requested = 'stripe' THEN 'Kat Kredi'
          ELSE 'MonCash Otomatik'
        END) ||
        ' echwe: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) TO service_role;
