-- Automates the admin payout queue: a default "priority" sort (largest
-- balance, then oldest unpaid commission, then oldest last payment) so the
-- admin never has to manually search for who's owed money, plus two
-- single-criterion sort options for manual override. Same signatures as
-- the v2 versions (only the _sort DEFAULT value and the ORDER BY logic
-- change) — no DROP FUNCTION needed, see docs/reference/MIGRATIONS.md.

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
      LEFT JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
      WHERE cl.restaurant_id = r.id AND cl.entry_type IN ('order_commission', 'monthly_fee')
        AND pc.commission_ledger_id IS NULL
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
    -- 'priority' (the new default) and the fallback for any other value:
    -- largest balance first, then oldest unpaid commission, then oldest
    -- last payment (never-paid ranks first via NULLS FIRST).
    b.available_balance DESC,
    b.oldest_unpaid_commission ASC NULLS LAST,
    b.last_payment_date ASC NULLS FIRST
  LIMIT _limit OFFSET _offset;
END;
$$;

-- Symmetric driver version — identical shape/logic, joined to drivers.
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
      LEFT JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
      WHERE cl.driver_id = dr.id AND cl.entry_type IN ('order_commission', 'monthly_fee')
        AND pc.commission_ledger_id IS NULL
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

-- get_admin_payout_kpis: return shape is changing (new columns), which
-- CREATE OR REPLACE cannot do even with an identical (empty) argument list
-- — Postgres errors on a return-type change rather than silently
-- overloading. DROP FUNCTION IF EXISTS first, per docs/reference/MIGRATIONS.md.
DROP FUNCTION IF EXISTS public.get_admin_payout_kpis();

CREATE FUNCTION public.get_admin_payout_kpis()
RETURNS TABLE (
  owed_restaurants numeric, owed_drivers numeric, commissions_this_month numeric,
  total_paid numeric, total_pending numeric, payout_count bigint, dispute_count bigint,
  restaurants_waiting_count bigint, drivers_waiting_count bigint,
  largest_unpaid_restaurant_name text, largest_unpaid_restaurant_amount numeric,
  largest_unpaid_driver_name text, largest_unpaid_driver_amount numeric,
  avg_payout_amount numeric, avg_payment_delay_hours numeric
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
    (SELECT count(*) FROM public.payouts WHERE status = 'disputed'),
    (SELECT count(*) FROM public.wallets WHERE restaurant_id IS NOT NULL AND available_balance > 0),
    (SELECT count(*) FROM public.wallets WHERE driver_id IS NOT NULL AND available_balance > 0),
    (SELECT r.name FROM public.wallets w JOIN public.restaurants r ON r.id = w.restaurant_id
      WHERE w.restaurant_id IS NOT NULL ORDER BY w.available_balance DESC LIMIT 1),
    (SELECT w.available_balance FROM public.wallets w
      WHERE w.restaurant_id IS NOT NULL ORDER BY w.available_balance DESC LIMIT 1),
    (SELECT trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, ''))
      FROM public.wallets w JOIN public.drivers dr ON dr.id = w.driver_id
      WHERE w.driver_id IS NOT NULL ORDER BY w.available_balance DESC LIMIT 1),
    (SELECT w.available_balance FROM public.wallets w
      WHERE w.driver_id IS NOT NULL ORDER BY w.available_balance DESC LIMIT 1),
    (SELECT avg(amount) FROM public.payouts),
    (SELECT avg(EXTRACT(EPOCH FROM (p.created_at - cl.created_at)) / 3600)
      FROM public.payout_commissions pc
      JOIN public.payouts p ON p.id = pc.payout_id
      JOIN public.commission_ledger cl ON cl.id = pc.commission_ledger_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_payout_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_payout_kpis() TO authenticated;

-- Realtime: payouts is already published (v2). wallets isn't yet — a wallet
-- row changes on every event that matters here (commission credit/reversal,
-- payout sent/confirmed/disputed/resolved), so subscribing to wallets alone
-- is enough to know "refetch everything" on every relevant page; no need to
-- also publish commission_ledger (react-query invalidation only needs the
-- signal, not the payload).
ALTER TABLE public.wallets REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wallets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
  END IF;
END $$;
