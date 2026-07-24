-- Links each commission_ledger row to (at most) the one payout that settled
-- it — the traceability layer requested on top of the v2 architecture. This
-- is purely additive: wallet balance math (wallets/wallet_transactions,
-- unchanged below) remains the actual source of truth for "how much is
-- owed"; this table only powers display/traceability ("which commissions
-- does this payout cover"). commission_ledger itself stays untouched and
-- immutable — no status column is ever added to it (see plan doc).

CREATE TABLE public.payout_commissions (
  payout_id uuid NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  commission_ledger_id uuid NOT NULL REFERENCES public.commission_ledger(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A commission can only ever be linked to one payout (no splitting across
  -- multiple payouts) — this single PK both identifies the row and enforces
  -- that constraint.
  PRIMARY KEY (commission_ledger_id)
);
CREATE INDEX payout_commissions_payout_id_idx ON public.payout_commissions(payout_id);

ALTER TABLE public.payout_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_commissions read" ON public.payout_commissions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commission_ledger cl
      WHERE cl.id = commission_ledger_id
        AND private.payout_beneficiary_visible(cl.restaurant_id, cl.driver_id)
    )
  );
REVOKE ALL ON public.payout_commissions FROM PUBLIC, anon;
GRANT SELECT ON public.payout_commissions TO authenticated;

-- Re-created with the same signature (no DROP FUNCTION needed — args are
-- unchanged, see docs/MIGRATIONS.md) — identical body to
-- 20260722100200_payout_rpcs.sql's version, with one addition at the end:
-- after the existing wallet/payout/notification logic (all unchanged),
-- link whichever outstanding commissions fit within the paid amount.
CREATE OR REPLACE FUNCTION public.initiate_payout_secure(
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _method text DEFAULT NULL,
  _transaction_reference text DEFAULT NULL,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
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
    transaction_reference, proof_url, status, admin_notes, paid_by, status_history
  )
  VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    btrim(_transaction_reference), _proof_url, 'paid', NULLIF(btrim(_notes), ''), v_user,
    jsonb_build_array(jsonb_build_object('to', 'paid', 'by', v_user, 'at', now()))
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
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id));
  PERFORM private.log_audit_event(v_user, 'admin', 'wallet.debited',
    jsonb_build_object('wallet_id', v_wallet.id, 'amount', _amount, 'payout_id', v_row.id));

  -- Link outstanding commissions to this payout for traceability, oldest
  -- first, up to the paid amount. A commission is linked only if it fits
  -- entirely within what's left — no splitting a single commission across
  -- two payouts. Any leftover (e.g. a partial payout not exactly covering a
  -- whole commission) simply stays unlinked/"available" for a future
  -- payout; this never affects the wallet balance math above, which has
  -- already completed by this point.
  v_remaining := _amount;
  FOR v_commission IN
    SELECT cl.id, cl.net_amount
    FROM public.commission_ledger cl
    LEFT JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
    WHERE pc.commission_ledger_id IS NULL
      AND cl.entry_type IN ('order_commission', 'monthly_fee')
      AND ((_restaurant_id IS NOT NULL AND cl.restaurant_id = _restaurant_id)
        OR (_driver_id IS NOT NULL AND cl.driver_id = _driver_id))
    ORDER BY cl.created_at ASC
  LOOP
    EXIT WHEN v_commission.net_amount > v_remaining;
    INSERT INTO public.payout_commissions (payout_id, commission_ledger_id) VALUES (v_row.id, v_commission.id);
    v_remaining := v_remaining - v_commission.net_amount;
  END LOOP;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text) TO authenticated;
