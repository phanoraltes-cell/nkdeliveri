-- Phase 3 of the admin evolution plan: prepare the architecture for real
-- MonCash/NatCash API integration, without touching the manual flow at
-- all. `payment_methods` already describes *which rail* a payout uses
-- (moncash/natcash) -- but conflates that with *who executes it*, which
-- is 100% human today regardless of rail (initiate_payout_secure's
-- moncash/natcash branch only decides which receiver_number/
-- receiver_account_name column pair to read; no network call happens
-- anywhere). The real missing axis is execution provider, not rail --
-- and a real provider integration is TypeScript/Node work (calling an
-- external HTTP API), not SQL, since a SECURITY DEFINER Postgres
-- function has no outbound network access. This migration only teaches
-- the schema to record *which* provider executed a payout, so the
-- application layer (src/lib/payment-providers/) has somewhere to write
-- that fact once a real API exists -- it changes no behavior today.

CREATE TABLE public.payment_providers (
  code text PRIMARY KEY,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.payment_providers (code, label, is_active) VALUES
  ('manual', 'Manyèl (admin)', true),
  ('moncash_api', 'MonCash API', false),
  ('natcash_api', 'NatCash API', false);
-- moncash_api/natcash_api start inactive -- there is no real integration
-- yet, so nothing should ever let an admin pick them. Flipping is_active
-- to true is the one-line cutover once a real API key/integration exists,
-- exactly the "add a provider = one file + one row" goal from the plan.

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_providers read" ON public.payment_providers FOR SELECT TO authenticated
  USING (true);
REVOKE ALL ON public.payment_providers FROM PUBLIC, anon;
GRANT SELECT ON public.payment_providers TO authenticated;

ALTER TABLE public.payouts ADD COLUMN provider_code text NOT NULL DEFAULT 'manual'
  REFERENCES public.payment_providers(code);
-- Every payout ever sent so far was manual -- the DEFAULT backfills
-- existing rows correctly with zero data migration needed.

-- Same signature as 20260722150000_perf_index_and_lateral_fix.sql plus
-- one new trailing optional param -- DROP FUNCTION first (argument list
-- changes), same rule as everywhere else in this project. Every existing
-- call site (payout-pay-modal.tsx's 6 named args) keeps working
-- unmodified since _provider_code defaults to 'manual' -- identical
-- behavior to today. The only change is one extra column written on the
-- INSERT; wallet debit, wallet_transactions, notification, audit log,
-- and the commission-linking loop are byte-for-byte unchanged.
DROP FUNCTION IF EXISTS public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text);

CREATE FUNCTION public.initiate_payout_secure(
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _method text DEFAULT NULL,
  _transaction_reference text DEFAULT NULL,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _provider_code text DEFAULT 'manual'
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
  v_remaining numeric;
  v_link_amount numeric;
  v_commission record;
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
$$;
REVOKE ALL ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text, text) TO authenticated;
