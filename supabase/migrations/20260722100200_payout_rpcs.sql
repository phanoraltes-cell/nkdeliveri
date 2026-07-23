-- Manual payout mutation RPCs: admin sends a payout (proof + reference
-- collected in the same action, per the single "validation" step described
-- in the spec), beneficiary confirms or disputes it, admin arbitrates a
-- dispute (status -> 'resolved' with a distinct `resolution` outcome so a
-- payout that was contested and later confirmed still records that it was
-- once disputed), admin charges a flat monthly commission fee, and admin
-- can rebuild a wallet from wallet_transactions if it's ever suspected to
-- be out of sync. All SECURITY DEFINER, all validate + write +
-- wallet_transactions + notify + audit-log inline.

-- 1) Admin sends a manual payout to a restaurant or driver. Money has
-- already been sent via MonCash/NatCash by the time this is called — the
-- reference/proof are evidence of a transfer that already happened, so the
-- payout is created directly at status 'paid' (not a separate draft step).
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

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text) TO authenticated;

-- 2) Beneficiary confirms receipt of a payout.
CREATE OR REPLACE FUNCTION public.confirm_payout_secure(_payout_id uuid)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payouts;
  v_is_owner boolean;
BEGIN
  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  v_is_owner :=
    (v_row.restaurant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = v_row.restaurant_id AND r.owner_id = v_user))
    OR (v_row.driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_row.driver_id AND d.user_id = v_user));
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'paid' THEN
    RAISE EXCEPTION 'Peman sa a pa nan atant konfimasyon';
  END IF;

  UPDATE public.payouts SET
    status = 'confirmed', confirmed_at = now(), updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'confirmed', 'by', v_user, 'at', now())
  WHERE id = _payout_id
  RETURNING * INTO v_row;

  UPDATE public.wallets SET
    pending_balance = pending_balance - v_row.amount, paid_balance = paid_balance + v_row.amount, updated_at = now()
  WHERE id = v_row.wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, pending_delta, paid_delta, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_confirmed', -v_row.amount, v_row.amount, v_row.id, v_user, 'Benefisyè konfime');

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_row.paid_by, 'payout_confirmed', 'Peman konfime',
    'Benefisyè a konfime li resevwa peman ' || v_row.amount || ' HTG.',
    jsonb_build_object('payout_id', v_row.id));

  PERFORM private.log_audit_event(v_user, NULL, 'payout.confirmed', jsonb_build_object('payout_id', v_row.id));
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_payout_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_payout_secure(uuid) TO authenticated;

-- 3) Beneficiary reports a problem with a payout — mandatory reason, rate-
-- limited. No balance movement: the amount stays frozen in pending_balance
-- until an admin arbitrates via resolve_payout_dispute_secure.
CREATE OR REPLACE FUNCTION public.dispute_payout_secure(_payout_id uuid, _reason text)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payouts;
  v_is_owner boolean;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Tanpri eksplike pwoblèm nan (omwen 5 karaktè)';
  END IF;
  IF NOT public.check_rate_limit_secure('dispute_payout', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  v_is_owner :=
    (v_row.restaurant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = v_row.restaurant_id AND r.owner_id = v_user))
    OR (v_row.driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_row.driver_id AND d.user_id = v_user));
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'paid' THEN
    RAISE EXCEPTION 'Peman sa a pa ka rapòte kounye a';
  END IF;

  UPDATE public.payouts SET
    status = 'disputed', dispute_reason = btrim(_reason), disputed_at = now(), updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'disputed', 'by', v_user, 'at', now())
  WHERE id = _payout_id
  RETURNING * INTO v_row;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'payout_disputed', 'Yon peman kontete',
    'Yon benefisyè rapòte yon pwoblèm sou yon peman ' || v_row.amount || ' HTG.',
    jsonb_build_object('payout_id', v_row.id)
  FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');

  PERFORM private.log_audit_event(v_user, NULL, 'payout.disputed', jsonb_build_object('payout_id', v_row.id, 'reason', _reason));
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.dispute_payout_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispute_payout_secure(uuid, text) TO authenticated;

-- 4) Admin arbitrates a disputed payout. Status always becomes 'resolved'
-- (a distinct terminal state from 'confirmed', so a payout that was once
-- contested keeps that fact visible) with a `resolution` sub-field
-- recording the actual outcome: 'confirmed' (money really was received,
-- settle it like a normal confirmation) or 'reversed' (payout was wrong,
-- money goes back to available_balance so the admin can correct and re-pay).
CREATE OR REPLACE FUNCTION public.resolve_payout_dispute_secure(
  _payout_id uuid, _resolution text, _admin_notes text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payouts;
  v_beneficiary_user uuid;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _resolution NOT IN ('confirmed', 'reversed') THEN
    RAISE EXCEPTION 'Invalid resolution';
  END IF;

  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_row.status <> 'disputed' THEN
    RAISE EXCEPTION 'Peman sa a pa an litij';
  END IF;

  UPDATE public.payouts SET
    status = 'resolved', resolution = _resolution, resolved_by = v_user, resolved_at = now(),
    admin_notes = COALESCE(NULLIF(btrim(_admin_notes), ''), admin_notes), updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'resolved', 'resolution', _resolution, 'by', v_user, 'at', now())
  WHERE id = _payout_id
  RETURNING * INTO v_row;

  IF _resolution = 'confirmed' THEN
    UPDATE public.wallets SET pending_balance = pending_balance - v_row.amount, paid_balance = paid_balance + v_row.amount, updated_at = now()
    WHERE id = v_row.wallet_id;
    INSERT INTO public.wallet_transactions (wallet_id, type, pending_delta, paid_delta, payout_id, created_by, note)
    VALUES (v_row.wallet_id, 'payout_confirmed', -v_row.amount, v_row.amount, v_row.id, v_user, 'Rezoud - konfime pa admin');
  ELSE
    UPDATE public.wallets SET pending_balance = pending_balance - v_row.amount, available_balance = available_balance + v_row.amount, updated_at = now()
    WHERE id = v_row.wallet_id;
    INSERT INTO public.wallet_transactions (wallet_id, type, pending_delta, available_delta, payout_id, created_by, note)
    VALUES (v_row.wallet_id, 'payout_reversed', -v_row.amount, v_row.amount, v_row.id, v_user, 'Rezoud - ranvèse pa admin');
  END IF;

  SELECT COALESCE(
    (SELECT owner_id FROM public.restaurants WHERE id = v_row.restaurant_id),
    (SELECT user_id FROM public.drivers WHERE id = v_row.driver_id)
  ) INTO v_beneficiary_user;

  IF v_beneficiary_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_beneficiary_user, CASE WHEN _resolution = 'confirmed' THEN 'payout_confirmed' ELSE 'payout_reversed' END,
      CASE WHEN _resolution = 'confirmed' THEN 'Peman konfime' ELSE 'Peman ranvèse' END,
      CASE WHEN _resolution = 'confirmed' THEN 'Yon administratè konfime peman ' || v_row.amount || ' HTG la.'
           ELSE 'Peman ' || v_row.amount || ' HTG la ranvèse. Li retounen nan balans disponib ou.' END,
      jsonb_build_object('payout_id', v_row.id));
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.resolved',
    jsonb_build_object('payout_id', v_row.id, 'resolution', _resolution));
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_payout_dispute_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_payout_dispute_secure(uuid, text, text) TO authenticated;

-- 5) Flat monthly commission charge for commission_type = 'monthly' restaurants.
CREATE OR REPLACE FUNCTION public.charge_restaurant_monthly_fee_secure(
  _restaurant_id uuid, _period date DEFAULT (date_trunc('month', now()))::date
)
RETURNS public.commission_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_type text;
  v_amount numeric;
  v_period date := (date_trunc('month', _period))::date;
  v_row public.commission_ledger;
  v_wallet_id uuid;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT commission_type, monthly_commission_amount INTO v_type, v_amount
  FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
  IF v_type IS DISTINCT FROM 'monthly' THEN
    RAISE EXCEPTION 'Restoran sa a pa configire pou komisyon chak mwa';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Pa gen montan komisyon chak mwa configire';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_ledger
    WHERE restaurant_id = _restaurant_id AND entry_type = 'monthly_fee' AND period_month = v_period
  ) THEN
    RAISE EXCEPTION 'Komisyon mwa sa a deja fakti';
  END IF;

  INSERT INTO public.commission_ledger (restaurant_id, entry_type, gross_amount, commission_amount, net_amount, period_month, created_by)
  VALUES (_restaurant_id, 'monthly_fee', 0, v_amount, -v_amount, v_period, v_user)
  RETURNING * INTO v_row;

  INSERT INTO public.wallets (restaurant_id, available_balance)
  VALUES (_restaurant_id, -v_amount)
  ON CONFLICT (restaurant_id) DO UPDATE SET available_balance = wallets.available_balance - v_amount, updated_at = now()
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, commission_ledger_id, created_by, note)
  VALUES (v_wallet_id, 'commission_credit', -v_amount, v_row.id, v_user, 'Komisyon chak mwa ' || to_char(v_period, 'Mon YYYY'));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.owner_id, 'monthly_commission_charged', 'Komisyon chak mwa fakti',
    'Yon komisyon chak mwa ' || v_amount || ' HTG fakti sou kont ou pou ' || to_char(v_period, 'Mon YYYY') || '.',
    jsonb_build_object('restaurant_id', _restaurant_id, 'amount', v_amount, 'period', v_period)
  FROM public.restaurants r WHERE r.id = _restaurant_id AND r.owner_id IS NOT NULL;

  PERFORM private.log_audit_event(v_user, 'admin', 'commission.monthly_fee_charged',
    jsonb_build_object('restaurant_id', _restaurant_id, 'amount', v_amount, 'period', v_period));
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.charge_restaurant_monthly_fee_secure(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charge_restaurant_monthly_fee_secure(uuid, date) TO authenticated;

-- 6) Wallet is never the source of truth — this rebuilds one entirely from
-- wallet_transactions (the real ledger), the exact implementation of "si un
-- Wallet est corrompu, il doit pouvoir être recalculé automatiquement à
-- partir du Ledger". Idempotent: running it twice in a row gives the same
-- result, since the recompute marker itself carries zero deltas.
CREATE OR REPLACE FUNCTION public.recompute_wallet_secure(_restaurant_id uuid DEFAULT NULL, _driver_id uuid DEFAULT NULL)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_sum record;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE restaurant_id = _restaurant_id FOR UPDATE;
  ELSE
    SELECT * INTO v_wallet FROM public.wallets WHERE driver_id = _driver_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen wallet pou benefisyè sa a';
  END IF;

  SELECT
    COALESCE(sum(available_delta), 0) AS available,
    COALESCE(sum(pending_delta), 0) AS pending,
    COALESCE(sum(paid_delta), 0) AS paid,
    COALESCE(sum(lifetime_delta), 0) AS lifetime
  INTO v_sum
  FROM public.wallet_transactions WHERE wallet_id = v_wallet.id;

  UPDATE public.wallets SET
    available_balance = v_sum.available,
    pending_balance = v_sum.pending,
    paid_balance = v_sum.paid,
    lifetime_earnings = v_sum.lifetime,
    updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.wallet_transactions (wallet_id, type, created_by, note)
  VALUES (v_wallet.id, 'wallet_recomputed', v_user, 'Rekalkile apati wallet_transactions');

  PERFORM private.log_audit_event(v_user, 'admin', 'wallet.recomputed',
    jsonb_build_object('wallet_id', v_wallet.id, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id,
      'available_balance', v_wallet.available_balance, 'pending_balance', v_wallet.pending_balance,
      'paid_balance', v_wallet.paid_balance, 'lifetime_earnings', v_wallet.lifetime_earnings));

  RETURN v_wallet;
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_wallet_secure(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_wallet_secure(uuid, uuid) TO authenticated;
