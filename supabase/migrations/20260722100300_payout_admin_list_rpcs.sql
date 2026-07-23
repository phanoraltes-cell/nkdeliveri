-- Admin read-side RPCs for the Payouts dashboard: paginated/filterable/
-- sortable restaurant & driver wallet lists (mirrors the count(*) OVER()
-- pagination convention from 20260714121500_paginate_admin_lists.sql), KPI
-- totals, monthly time series, and top-beneficiary rankings. total_orders/
-- last_payment_date are computed here from commission_ledger/payouts rather
-- than stored on wallets (which holds only the 4 balance columns). Reading
-- a single beneficiary's own payout history needs no RPC — payouts is
-- directly SELECT-able under its RLS policy.

CREATE FUNCTION public.get_restaurant_wallets_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _sort text DEFAULT 'balance_desc',
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
      SELECT status FROM public.payouts p WHERE p.restaurant_id = r.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
    WHERE r.owner_id IS NOT NULL
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    b.available_balance DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurant_wallets_admin(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_wallets_admin(text, text, text, int, int) TO authenticated;

-- Symmetric driver version — same shape, joined to drivers instead of the
-- restaurant_payout_details child table.
CREATE FUNCTION public.get_driver_wallets_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _sort text DEFAULT 'balance_desc',
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
      SELECT status FROM public.payouts p WHERE p.driver_id = dr.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    b.available_balance DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_driver_wallets_admin(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_wallets_admin(text, text, text, int, int) TO authenticated;

-- KPI row for the admin Payouts dashboard header (server-side aggregates,
-- never client-side) — the 7 values requested: amount owed to restaurants,
-- amount owed to drivers, this month's commissions, amount already paid,
-- amount remaining (in flight, awaiting confirmation), number of payouts,
-- number of disputes.
CREATE FUNCTION public.get_admin_payout_kpis()
RETURNS TABLE (
  owed_restaurants numeric, owed_drivers numeric, commissions_this_month numeric,
  total_paid numeric, total_pending numeric, payout_count bigint, dispute_count bigint
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
  RETURN QUERY
  SELECT
    COALESCE((SELECT sum(available_balance) FROM public.wallets WHERE restaurant_id IS NOT NULL), 0),
    COALESCE((SELECT sum(available_balance) FROM public.wallets WHERE driver_id IS NOT NULL), 0),
    COALESCE((SELECT sum(commission_amount) FROM public.commission_ledger
      WHERE entry_type IN ('order_commission', 'monthly_fee')
        AND date_trunc('month', created_at) = date_trunc('month', now())), 0),
    COALESCE((SELECT sum(paid_balance) FROM public.wallets), 0),
    COALESCE((SELECT sum(pending_balance) FROM public.wallets), 0),
    (SELECT count(*) FROM public.payouts),
    (SELECT count(*) FROM public.payouts WHERE status = 'disputed');
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_payout_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_payout_kpis() TO authenticated;

-- Two monthly series for RevenueChart: commissions earned by the platform,
-- and money actually paid out to beneficiaries.
CREATE FUNCTION public.get_commission_monthly_series(_from date, _to date)
RETURNS TABLE (month date, total_commission numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT date_trunc('month', created_at)::date, sum(commission_amount)
  FROM public.commission_ledger
  WHERE entry_type IN ('order_commission', 'monthly_fee') AND created_at::date BETWEEN _from AND _to
  GROUP BY 1 ORDER BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_commission_monthly_series(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_commission_monthly_series(date, date) TO authenticated;

CREATE FUNCTION public.get_payouts_monthly_series(_from date, _to date)
RETURNS TABLE (month date, total_paid numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT date_trunc('month', created_at)::date, sum(amount)
  FROM public.payouts
  WHERE status IN ('paid', 'confirmed', 'resolved') AND created_at::date BETWEEN _from AND _to
  GROUP BY 1 ORDER BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payouts_monthly_series(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payouts_monthly_series(date, date) TO authenticated;

-- Top restaurants / top drivers by commission generated over a period —
-- the platform's own revenue lens, not the beneficiary's earnings.
CREATE FUNCTION public.get_top_restaurants_by_commission(_from date, _to date, _limit int DEFAULT 5)
RETURNS TABLE (restaurant_id uuid, name text, total_commission numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 50 THEN
    _limit := 5;
  END IF;
  RETURN QUERY
  SELECT r.id, r.name, sum(cl.commission_amount)
  FROM public.commission_ledger cl
  JOIN public.restaurants r ON r.id = cl.restaurant_id
  WHERE cl.entry_type IN ('order_commission', 'monthly_fee') AND cl.created_at::date BETWEEN _from AND _to
  GROUP BY r.id, r.name
  ORDER BY sum(cl.commission_amount) DESC
  LIMIT _limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_top_restaurants_by_commission(date, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_restaurants_by_commission(date, date, int) TO authenticated;

CREATE FUNCTION public.get_top_drivers_by_commission(_from date, _to date, _limit int DEFAULT 5)
RETURNS TABLE (driver_id uuid, name text, total_commission numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 50 THEN
    _limit := 5;
  END IF;
  RETURN QUERY
  SELECT dr.id, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')), sum(cl.commission_amount)
  FROM public.commission_ledger cl
  JOIN public.drivers dr ON dr.id = cl.driver_id
  WHERE cl.entry_type IN ('order_commission', 'monthly_fee') AND cl.created_at::date BETWEEN _from AND _to
  GROUP BY dr.id, dr.first_name, dr.last_name
  ORDER BY sum(cl.commission_amount) DESC
  LIMIT _limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_top_drivers_by_commission(date, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_drivers_by_commission(date, date, int) TO authenticated;
