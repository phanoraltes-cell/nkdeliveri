-- MonCash webhook support: a real async payout lifecycle.
--
-- Until now, `payouts` only ever modeled a transfer that had *already
-- happened* (an admin sent money by hand, then recorded it) -- status
-- started at 'paid' and there was no 'pending'/'failed' state, because
-- initiate_payout_secure's only caller was that manual flow. A payment
-- provider webhook needs somewhere to record "we asked a provider to
-- send this, unconfirmed" and later flip it to confirmed/failed -- this
-- migration adds that lifecycle without touching the manual flow's
-- existing behavior at all (initiate_payout_secure is not modified).
--
-- Still true today, unchanged by this migration: MonCash's public API
-- has no confirmed B2C disbursement endpoint (see
-- docs/PAYMENT_PROVIDERS.md), so create_pending_payout_secure has no
-- live caller yet -- this is schema/RPC work that stays unreachable
-- until that external gap closes, same posture as the rest of the
-- payment-providers work this session.

-- ---------------------------------------------------------------------------
-- 1) payout_status: enum -> text + CHECK, adding 'pending' and 'failed'.
-- Same rationale as 20260722210000_disputes_redesign.sql: avoids
-- ALTER TYPE ADD VALUE's same-transaction restrictions. Old enum type
-- left in place (unused by this column from now on, harmless).
ALTER TABLE public.payouts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.payouts ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending', 'paid', 'confirmed', 'disputed', 'resolved', 'failed'));
ALTER TABLE public.payouts ALTER COLUMN status SET DEFAULT 'paid';
-- Default stays 'paid', not 'pending' -- the manual flow (still the only
-- reachable path) creates a payout directly at 'paid', exactly as today.

-- 2) Informational: the provider's own transaction id, once known
-- (distinct from transaction_reference, which for a provider-created
-- payout holds *our* idempotency reference throughout its lifecycle so
-- the webhook can always look the row up by something we chose).
ALTER TABLE public.payouts ADD COLUMN provider_transaction_id text;

CREATE INDEX payouts_provider_reference_idx
  ON public.payouts(provider_code, transaction_reference);

-- 3) wallet_transactions.type: extend the CHECK list for the 3 new
-- ledger events this lifecycle introduces. Kept distinct from the
-- existing 'payout_sent'/'payout_confirmed'/'payout_reversed' (which
-- mean "an admin's own hands already sent this" / "beneficiary
-- confirmed receipt" / "admin resolved a dispute by reversing") even
-- though 'payout_pending' has the same delta shape as 'payout_sent' --
-- the business meaning differs (intent vs. fact) and that distinction is
-- worth keeping visible in the ledger.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'commission_credit', 'commission_reversed',
    'payout_sent', 'payout_confirmed', 'payout_reversed',
    'payout_pending', 'payout_provider_confirmed', 'payout_provider_failed',
    'wallet_recomputed'
  ));

-- ---------------------------------------------------------------------------
-- 4) Webhook delivery ledger -- the idempotency + audit record for every
-- inbound MonCash webhook call, valid or not, processed or not. Separate
-- from public.audit_log (which only records the *business* events this
-- produces) so a rejected/duplicate delivery is never silently invisible.
-- Service-role only (the webhook route uses supabaseAdmin, never a user
-- session) -- no authenticated/anon policy grants any access at all,
-- admins get read-only visibility for support/debugging.
CREATE TABLE public.moncash_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  transaction_reference text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'rejected', 'failed')),
  outcome text,
  payload jsonb NOT NULL,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (event_id)
);
CREATE INDEX moncash_webhook_events_transaction_reference_idx
  ON public.moncash_webhook_events(transaction_reference);
CREATE INDEX moncash_webhook_events_received_at_idx
  ON public.moncash_webhook_events(received_at DESC);

ALTER TABLE public.moncash_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moncash_webhook_events admin read" ON public.moncash_webhook_events FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.moncash_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.moncash_webhook_events TO authenticated;
GRANT ALL ON public.moncash_webhook_events TO service_role;

-- ---------------------------------------------------------------------------
-- 5) create_pending_payout_secure -- the async counterpart to
-- initiate_payout_secure, called by an admin session (via
-- initiate-provider-payout.functions.ts) the moment a payment provider
-- reports "pending" rather than an immediate "success". Reserves the
-- funds exactly like the manual flow does (available -> pending
-- balance), but sends no beneficiary notification and links no
-- commissions yet -- both deferred to complete_pending_payout_secure,
-- since nothing has actually been sent until the provider confirms it.
CREATE FUNCTION public.create_pending_payout_secure(
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _method text DEFAULT NULL,
  _own_reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _provider_code text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_receiver_number text;
  v_receiver_account text;
  v_beneficiary_user uuid;
  v_row public.payouts;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Montan envalid';
  END IF;
  IF _method IS NULL OR NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = _method AND is_active) THEN
    RAISE EXCEPTION 'Chwazi yon metòd peman valid';
  END IF;
  IF _provider_code IS NULL OR _provider_code = 'manual'
     OR NOT EXISTS (SELECT 1 FROM public.payment_providers WHERE code = _provider_code AND is_active) THEN
    RAISE EXCEPTION 'Pwovidè peman sa a pa disponib';
  END IF;
  IF _own_reference IS NULL OR length(btrim(_own_reference)) = 0 THEN
    RAISE EXCEPTION 'Referans obligatwa';
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
    transaction_reference, status, admin_notes, paid_by, status_history, provider_code
  )
  VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    btrim(_own_reference), 'pending', NULLIF(btrim(_notes), ''), v_user,
    jsonb_build_array(jsonb_build_object('to', 'pending', 'by', v_user, 'at', now())), _provider_code
  )
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_wallet.id, 'payout_pending', -_amount, _amount, v_row.id, v_user, 'Peman mande bay pwovidè a');

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.pending_created',
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id, 'provider_code', _provider_code));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pending_payout_secure(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_payout_secure(uuid, uuid, numeric, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) complete_pending_payout_secure / fail_pending_payout_secure -- called
-- ONLY by the MonCash webhook handler via the service-role client
-- (supabaseAdmin), never by a user session: there is no auth.uid() during
-- an inbound webhook call, so unlike every other *_secure function in
-- this schema, these do not (cannot) check private.has_role. The
-- authorization boundary is the GRANT itself (service_role only, REVOKE
-- from authenticated/anon/PUBLIC) plus the signature verification the
-- webhook route performs before ever calling these -- see
-- src/lib/payment-providers/moncash-webhook-handler.server.ts and
-- docs/MONCASH_WEBHOOK_SECURITY.md.
--
-- Both look up the payout by (transaction_reference, provider_code) --
-- our own idempotency reference, known since create_pending_payout_secure
-- -- and both are themselves idempotent: calling either on a payout that
-- has already left 'pending' just returns the row unchanged rather than
-- re-applying a wallet movement or re-sending a notification. This is a
-- second, independent idempotency layer under the moncash_webhook_events
-- ledger (belt and suspenders: a bug in the ledger check must not be able
-- to double-credit or double-reverse a wallet).
CREATE FUNCTION public.complete_pending_payout_secure(
  _transaction_reference text,
  _provider_code text,
  _provider_transaction_id text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payouts;
  v_beneficiary_user uuid;
  v_remaining numeric;
  v_link_amount numeric;
  v_commission record;
BEGIN
  SELECT * INTO v_row FROM public.payouts
    WHERE transaction_reference = _transaction_reference AND provider_code = _provider_code
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen okenn peman an atant pou referans sa a';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  UPDATE public.payouts SET
    status = 'paid',
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'paid', 'via', 'webhook', 'at', now())
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- No wallet balance movement -- the amount already left
  -- available_balance into pending_balance in create_pending_payout_secure;
  -- this only confirms the transfer happened. A zero-delta ledger row
  -- keeps the event visible in wallet_transactions for observability.
  INSERT INTO public.wallet_transactions (wallet_id, type, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_provider_confirmed', v_row.id, NULL, 'Pwovidè konfime lajan an voye');

  IF v_row.restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = v_row.restaurant_id;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = v_row.driver_id;
  END IF;
  IF v_beneficiary_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_beneficiary_user, 'payout_paid', 'Ou resevwa yon peman',
      'Ou resevwa yon peman ' || v_row.amount || ' HTG. Tanpri konfime resepsyon an.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));
  END IF;

  -- Commission linking, deferred from creation time -- only a *confirmed*
  -- transfer should count as having paid down outstanding commissions.
  -- Same loop as initiate_payout_secure/20260722190000_payment_provider_prep.sql.
  v_remaining := v_row.amount;
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
      AND ((v_row.restaurant_id IS NOT NULL AND cl.restaurant_id = v_row.restaurant_id)
        OR (v_row.driver_id IS NOT NULL AND cl.driver_id = v_row.driver_id))
    ORDER BY cl.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_link_amount := LEAST(v_commission.outstanding, v_remaining);
    INSERT INTO public.payout_commissions (payout_id, commission_ledger_id, covered_amount)
    VALUES (v_row.id, v_commission.id, v_link_amount);
    v_remaining := v_remaining - v_link_amount;
  END LOOP;

  PERFORM private.log_audit_event(NULL, 'system', 'payout.provider_confirmed',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'provider_code', v_row.provider_code, 'provider_transaction_id', _provider_transaction_id));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_pending_payout_secure(text, text, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.complete_pending_payout_secure(text, text, text) TO service_role;

CREATE FUNCTION public.fail_pending_payout_secure(
  _transaction_reference text,
  _provider_code text,
  _reason text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payouts;
BEGIN
  SELECT * INTO v_row FROM public.payouts
    WHERE transaction_reference = _transaction_reference AND provider_code = _provider_code
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen okenn peman an atant pou referans sa a';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  UPDATE public.payouts SET
    status = 'failed',
    admin_notes = COALESCE(NULLIF(btrim(_reason), ''), admin_notes),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'failed', 'via', 'webhook', 'at', now(), 'reason', _reason)
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Release the reservation -- the money never actually left the wallet
  -- (create_pending_payout_secure only moved it available -> pending), so
  -- it goes straight back to available_balance, never through paid_balance.
  UPDATE public.wallets SET
    available_balance = available_balance + v_row.amount,
    pending_balance = pending_balance - v_row.amount,
    updated_at = now()
  WHERE id = v_row.wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_provider_failed', v_row.amount, -v_row.amount, v_row.id, NULL, COALESCE(NULLIF(btrim(_reason), ''), 'Pwovidè echwe'));

  -- Notify the admin who initiated it, not the beneficiary -- who was
  -- never told about it (create_pending_payout_secure sends no
  -- beneficiary notification for exactly this reason).
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_row.paid_by, 'payout_provider_failed', 'Peman pwovidè echwe',
    'Yon tantativ peman ' || v_row.amount || ' HTG atravè ' || v_row.provider_code || ' echwe. Lajan an retounen nan balans disponib la.',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));

  PERFORM private.log_audit_event(NULL, 'system', 'payout.provider_failed',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'provider_code', v_row.provider_code, 'reason', _reason));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_pending_payout_secure(text, text, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fail_pending_payout_secure(text, text, text) TO service_role;
