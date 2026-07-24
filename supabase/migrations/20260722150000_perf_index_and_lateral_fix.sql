-- Performance phase 1+2 (per the financial-module performance audit run
-- earlier this session): restore the index lost when payout_commissions'
-- primary key became composite, and stop re-aggregating the entire
-- payout_commissions table once per beneficiary row.
--
-- Nothing here changes any business rule, calculation, RLS policy, or RPC
-- signature -- every function below keeps its exact existing argument
-- list and RETURNS shape, so this is a pure CREATE OR REPLACE with no
-- DROP FUNCTION needed anywhere in this file. Only the internal query
-- plan changes; the result set is identical row-for-row, column-for-
-- column, to what each function already returns today.

-- ---------------------------------------------------------------------------
-- Phase 1: the missing index.
--
-- 20260722130000_fix_payout_commission_linking.sql replaced
-- `PRIMARY KEY (commission_ledger_id)` with a composite
-- `PRIMARY KEY (payout_id, commission_ledger_id)` -- required so a single
-- commission can be linked across several payouts (partial coverage), but
-- it removed the single-column index that made "look up by
-- commission_ledger_id" O(log n). A composite btree on (payout_id,
-- commission_ledger_id) cannot serve a commission_ledger_id-only lookup
-- (commission_ledger_id is the second column, not the leading one) --
-- every such lookup now falls back to a full scan of the table. This
-- exact lookup is used by initiate_payout_secure's linking loop,
-- get_restaurant_wallets_admin/get_driver_wallets_admin's
-- oldest_unpaid_commission calculation, and
-- get_restaurant_commissions_secure/get_driver_commissions_secure's
-- covered-amount lookup -- i.e. every hot read/write path this table has.
--
-- Purely additive: does not touch the composite primary key (still
-- enforces "a payout can only link a given commission once"), does not
-- remove payout_commissions_payout_id_idx, changes no behavior.
CREATE INDEX IF NOT EXISTS payout_commissions_commission_ledger_id_idx
  ON public.payout_commissions (commission_ledger_id);

-- ---------------------------------------------------------------------------
-- Phase 2 (+ the identical fix applied to initiate_payout_secure, which
-- Phase 1 above names as impacted by the missing index and which carries
-- the exact same anti-pattern being fixed here): every place that computed
-- "how much of this commission has been covered so far" did it via
--   LEFT JOIN (SELECT commission_ledger_id, sum(covered_amount) AS covered
--              FROM payout_commissions GROUP BY commission_ledger_id) pc_sum
--              ON pc_sum.commission_ledger_id = cl.id
-- The inner subquery has no WHERE clause at all -- it aggregates the
-- ENTIRE payout_commissions table, and because it sits inside a LATERAL
-- (get_restaurant/driver_wallets_admin) or a per-iteration loop query
-- (initiate_payout_secure), it re-runs that full-table aggregation once
-- per restaurant/driver row, or once per payout sent. Cost was O(beneficiaries
-- x total payout_commissions rows) instead of O(beneficiaries x rows
-- actually linked to that beneficiary's own commissions).
--
-- Fixed by correlating the inner lookup directly to cl.id (now indexed by
-- Phase 1 above), turning it into the LATERAL pattern already used
-- correctly elsewhere in these same functions (oc/lp2/lp).

-- Same signature as 20260722130000 -- no DROP needed. Only the linking
-- loop's FIFO query changes (the pc_sum join becomes a correlated
-- LATERAL); every other line -- validation, wallet lock/debit, payout
-- insert, wallet_transactions, notification, audit log -- is unchanged.
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
  -- first, up to the paid amount. Identical logic to before -- only the
  -- pc_sum lookup is now a correlated LATERAL (indexed, scoped to this one
  -- commission) instead of an unfiltered global GROUP BY recomputed on
  -- every call. This never affects the wallet balance math above, which
  -- has already completed by this point.
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

-- Same signature/return shape as 20260722130000 -- no DROP needed. Only
-- the oldest_unpaid_commission LATERAL's inner pc_sum lookup changes.
CREATE OR REPLACE FUNCTION public.get_restaurant_wallets_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _sort text DEFAULT 'priority',
  _limit int DEFAULT 50, _offset int DEFAULT 0
)
RETURNS TABLE (
  restaurant_id uuid, name text,
  moncash_number text, moncash_account_name text, natcash_number text, natcash_account_name text,
  available_balance numeric, pending_balance numeric, paid_balance numeric, lifetime_earnings numeric,
  total_orders integer, last_payment_date timestamptz, computed_status text, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT r.id AS restaurant_id, r.name,
      pd.moncash_number, pd.moncash_account_name, pd.natcash_number, pd.natcash_account_name,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.pending_balance, 0) AS pending_balance,
      COALESCE(w.paid_balance, 0) AS paid_balance,
      COALESCE(w.lifetime_earnings, 0) AS lifetime_earnings,
      COALESCE(oc.total_orders, 0) AS total_orders,
      lp2.last_payment_date,
      ouc.oldest_unpaid_commission,
      CASE
        WHEN COALESCE(w.available_balance, 0) > 0 THEN 'pending'
        WHEN lp.status = 'disputed' THEN 'disputed'
        WHEN lp.status IN ('paid', 'confirmed', 'resolved') THEN 'paid'
        ELSE 'settled'
      END AS computed_status
    FROM public.restaurants r
    LEFT JOIN public.restaurant_payout_details pd ON pd.restaurant_id = r.id
    LEFT JOIN public.wallets w ON w.restaurant_id = r.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_orders FROM public.commission_ledger cl
      WHERE cl.restaurant_id = r.id AND cl.entry_type = 'order_commission'
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT max(p.created_at) AS last_payment_date FROM public.payouts p
      WHERE p.restaurant_id = r.id AND p.status IN ('paid', 'confirmed', 'resolved')
    ) lp2 ON true
    LEFT JOIN LATERAL (
      SELECT min(cl.created_at) AS oldest_unpaid_commission
      FROM public.commission_ledger cl
      LEFT JOIN LATERAL (
        SELECT sum(pc.covered_amount) AS covered
        FROM public.payout_commissions pc
        WHERE pc.commission_ledger_id = cl.id
      ) pc_sum ON true
      WHERE cl.restaurant_id = r.id AND cl.entry_type = 'order_commission' AND cl.net_amount > 0
        AND COALESCE(pc_sum.covered, 0) < cl.net_amount
    ) ouc ON true
    LEFT JOIN LATERAL (
      SELECT status FROM public.payouts p WHERE p.restaurant_id = r.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
    WHERE r.owner_id IS NOT NULL
  )
  SELECT
    b.restaurant_id, b.name, b.moncash_number, b.moncash_account_name, b.natcash_number, b.natcash_account_name,
    b.available_balance, b.pending_balance, b.paid_balance, b.lifetime_earnings,
    b.total_orders, b.last_payment_date, b.computed_status, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest_unpaid_commission' THEN b.oldest_unpaid_commission END ASC NULLS LAST,
    CASE WHEN _sort = 'oldest_last_payment' THEN b.last_payment_date END ASC NULLS FIRST,
    b.available_balance DESC,
    b.oldest_unpaid_commission ASC NULLS LAST,
    b.last_payment_date ASC NULLS FIRST
  LIMIT _limit OFFSET _offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_driver_wallets_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _sort text DEFAULT 'priority',
  _limit int DEFAULT 50, _offset int DEFAULT 0
)
RETURNS TABLE (
  driver_id uuid, name text,
  moncash_number text, moncash_account_name text, natcash_number text, natcash_account_name text,
  available_balance numeric, pending_balance numeric, paid_balance numeric, lifetime_earnings numeric,
  total_orders integer, last_payment_date timestamptz, computed_status text, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT dr.id AS driver_id, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) AS name,
      dr.moncash_number, dr.moncash_account_name, dr.natcash_number, dr.natcash_account_name,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.pending_balance, 0) AS pending_balance,
      COALESCE(w.paid_balance, 0) AS paid_balance,
      COALESCE(w.lifetime_earnings, 0) AS lifetime_earnings,
      COALESCE(oc.total_orders, 0) AS total_orders,
      lp2.last_payment_date,
      ouc.oldest_unpaid_commission,
      CASE
        WHEN COALESCE(w.available_balance, 0) > 0 THEN 'pending'
        WHEN lp.status = 'disputed' THEN 'disputed'
        WHEN lp.status IN ('paid', 'confirmed', 'resolved') THEN 'paid'
        ELSE 'settled'
      END AS computed_status
    FROM public.drivers dr
    LEFT JOIN public.wallets w ON w.driver_id = dr.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_orders FROM public.commission_ledger cl
      WHERE cl.driver_id = dr.id AND cl.entry_type = 'order_commission'
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT max(p.created_at) AS last_payment_date FROM public.payouts p
      WHERE p.driver_id = dr.id AND p.status IN ('paid', 'confirmed', 'resolved')
    ) lp2 ON true
    LEFT JOIN LATERAL (
      SELECT min(cl.created_at) AS oldest_unpaid_commission
      FROM public.commission_ledger cl
      LEFT JOIN LATERAL (
        SELECT sum(pc.covered_amount) AS covered
        FROM public.payout_commissions pc
        WHERE pc.commission_ledger_id = cl.id
      ) pc_sum ON true
      WHERE cl.driver_id = dr.id AND cl.entry_type = 'order_commission' AND cl.net_amount > 0
        AND COALESCE(pc_sum.covered, 0) < cl.net_amount
    ) ouc ON true
    LEFT JOIN LATERAL (
      SELECT status FROM public.payouts p WHERE p.driver_id = dr.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
  )
  SELECT
    b.driver_id, b.name, b.moncash_number, b.moncash_account_name, b.natcash_number, b.natcash_account_name,
    b.available_balance, b.pending_balance, b.paid_balance, b.lifetime_earnings,
    b.total_orders, b.last_payment_date, b.computed_status, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest_unpaid_commission' THEN b.oldest_unpaid_commission END ASC NULLS LAST,
    CASE WHEN _sort = 'oldest_last_payment' THEN b.last_payment_date END ASC NULLS FIRST,
    b.available_balance DESC,
    b.oldest_unpaid_commission ASC NULLS LAST,
    b.last_payment_date ASC NULLS FIRST
  LIMIT _limit OFFSET _offset;
END;
$$;
