-- NatCash Otomatik integration (docs/PLOP_NATCASH_INTEGRATION_PLAN.md).
-- MonCash Otomatik and NatCash Otomatik become two independent checkout
-- buttons, both backed by the same PLOP gateway (plop-provider.server.ts,
-- unchanged) — only the checkout-flow wiring and this migration's gates
-- are new. Not applied automatically; versioned here per this project's
-- standing convention.

-- ---------------------------------------------------------------------------
-- 1) Seed the new checkout method's settings row — disabled by default,
-- exactly the same caution `moncash_auto` originally shipped with
-- (20260803120000_payment_provider_settings.sql): explicit admin
-- activation required before any real NatCash-via-PLOP traffic.
-- `provider` is a free-text UNIQUE column (no CHECK/enum) so this INSERT
-- needs no schema change.
INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider, maintenance_message) VALUES
  ('natcash_auto', true, false, false, 'NatCash Otomatik ap retounen byento.');

-- ---------------------------------------------------------------------------
-- 2) create_collect_payment_secure — signature unchanged, CREATE OR REPLACE
-- is safe (scripts/check-migration-hazards.mjs only flags a signature
-- change, confirmed none here). Two hardcodes generalized from "moncash
-- only" to "moncash or natcash", both flagged in
-- docs/PLOP_NATCASH_INTEGRATION_PLAN.md § 2.5 as the real crux of this
-- chantier:
--   a) the method-allowlist check (was `<> 'moncash'`)
--   b) the provider-enabled check (was hardcoded to the `moncash_auto` row
--      regardless of which wallet the payment actually is) — THIS is the
--      one that mattered most: without it, disabling MonCash Otomatik from
--      the admin dashboard would have silently disabled NatCash Otomatik
--      too, and vice versa, since both used to share the same lock.
-- The admin notification body is also made wallet-aware (was hardcoded
-- "Payment Global") so an admin can tell which automatic method actually
-- failed. Every other line is byte-for-byte identical to
-- 20260805110000_rename_collect_payment_notifications_to_payment_global.sql.
CREATE OR REPLACE FUNCTION public.create_collect_payment_secure(
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
  IF v_payment.method NOT IN ('moncash', 'natcash') THEN
    RAISE EXCEPTION 'Peman otomatik disponib sèlman pou MonCash oswa NatCash';
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

  -- MonCash Otomatik and NatCash Otomatik are independent checkout
  -- buttons — each gated by its OWN payment_provider_settings row, never
  -- a single shared one (docs/PLOP_NATCASH_INTEGRATION_PLAN.md § 2.5).
  v_provider_key := CASE WHEN v_payment.method = 'natcash' THEN 'natcash_auto' ELSE 'moncash_auto' END;
  v_provider_label := CASE WHEN v_payment.method = 'natcash' THEN 'NatCash Otomatik' ELSE 'MonCash Otomatik' END;

  -- Originally restored from 20260803130000_harden_create_collect_payment_provider_check.sql
  -- (same position, same reasoning — a pending row asserts that a real
  -- attempt was actually made against the provider; refuse to fabricate
  -- that claim if it's disabled, regardless of what called this RPC or
  -- how — closes the direct-RPC-call bypass scenario independent of
  -- initiate-collect-payment.logic.ts's own enabled check). A `failed` row
  -- carries no such claim, so it is not gated here.
  IF _status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_provider_settings
      WHERE provider = v_provider_key AND enabled = true
    ) THEN
      RAISE EXCEPTION '% pa disponib pou kounye a.', v_provider_label USING ERRCODE = '42501';
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
      'Yon tantativ peman ' || v_provider_label || ' ' || v_payment.amount || ' HTG echwe imedyatman: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', _payment_id, 'order_id', v_payment.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_collect_payment_secure(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) complete_collect_payment_secure — signature unchanged. Only the admin
-- notification body becomes wallet-aware, derived from the row's own
-- `payment_method_requested` (always populated at creation time) rather
-- than `_payment_method_used` (only ever populated by callers on a
-- confirmed *success* today — this `_decision = 'failed'` branch is
-- presently unreachable in practice, since every current caller only
-- ever passes `_decision:'paid'`, but is still made correct here rather
-- than left stale for whenever it is used). Every other line unchanged.
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
        (CASE WHEN v_row.payment_method_requested = 'natcash' THEN 'NatCash Otomatik' ELSE 'MonCash Otomatik' END) ||
        ' echwe: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_collect_payment_secure(text, text, text, text, jsonb, text) TO service_role;
