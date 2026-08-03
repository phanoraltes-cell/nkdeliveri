-- Admin Finance Dashboard — Phase 1. Three new READ-ONLY aggregate RPCs
-- that finalize the admin financial experience without touching any
-- existing table, trigger, or RPC. Every existing financial object
-- (wallets, commission_ledger, wallet_transactions, payouts,
-- payout_commissions, payments, payment_transactions,
-- moncash_webhook_events) is only ever read here, never written to or
-- altered. No DROP/ALTER/CREATE OR REPLACE on anything pre-existing.

-- ---------------------------------------------------------------------------
-- 1) get_admin_finance_overview_secure — the 12 KPI tiles for the Vue
-- globale tab. "aujourd'hui/semaine/mois" (payouts_today/_this_week/
-- _this_month) and the two balance snapshots (commissions_pending,
-- amount_to_disburse) intentionally IGNORE _from/_to -- "today" always
-- means today, same convention every dashboard uses; only the
-- period-scoped columns (total_commissions, commissions_paid,
-- restaurants_paid_count, drivers_paid_count, the 3 volumes) respect
-- the caller's date range. All "paid" bucketing here uses
-- payouts.created_at (consistent with the existing
-- get_payouts_monthly_series) -- a known, accepted limitation for a
-- future async MonCash-API payout, which isn't in production yet: its
-- created_at is the initiation moment, not the confirmation moment.
CREATE FUNCTION public.get_admin_finance_overview_secure(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS TABLE (
  total_commissions numeric,
  commissions_pending numeric,
  commissions_paid numeric,
  amount_to_disburse numeric,
  payouts_today numeric,
  payouts_this_week numeric,
  payouts_this_month numeric,
  restaurants_paid_count bigint,
  drivers_paid_count bigint,
  moncash_volume numeric,
  cash_volume numeric,
  natcash_volume numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT sum(commission_amount) FROM public.commission_ledger
      WHERE entry_type IN ('order_commission', 'monthly_fee')
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ), 0) AS total_commissions,
    COALESCE((SELECT sum(available_balance) + sum(pending_balance) FROM public.wallets), 0) AS commissions_pending,
    COALESCE((
      SELECT sum(cl.commission_amount)
      FROM public.commission_ledger cl
      JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
      JOIN public.payouts p ON p.id = pc.payout_id
      WHERE p.status IN ('paid', 'confirmed', 'resolved')
        AND (_from IS NULL OR p.created_at::date >= _from)
        AND (_to IS NULL OR p.created_at::date <= _to)
    ), 0) AS commissions_paid,
    COALESCE((SELECT sum(available_balance) FROM public.wallets), 0) AS amount_to_disburse,
    COALESCE((
      SELECT sum(amount) FROM public.payouts
      WHERE status IN ('paid', 'confirmed', 'resolved') AND created_at::date = current_date
    ), 0) AS payouts_today,
    COALESCE((
      SELECT sum(amount) FROM public.payouts
      WHERE status IN ('paid', 'confirmed', 'resolved')
        AND created_at::date >= current_date - interval '6 days'
    ), 0) AS payouts_this_week,
    COALESCE((
      SELECT sum(amount) FROM public.payouts
      WHERE status IN ('paid', 'confirmed', 'resolved')
        AND date_trunc('month', created_at) = date_trunc('month', now())
    ), 0) AS payouts_this_month,
    (
      SELECT count(DISTINCT restaurant_id) FROM public.payouts
      WHERE restaurant_id IS NOT NULL AND status IN ('paid', 'confirmed', 'resolved')
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ) AS restaurants_paid_count,
    (
      SELECT count(DISTINCT driver_id) FROM public.payouts
      WHERE driver_id IS NOT NULL AND status IN ('paid', 'confirmed', 'resolved')
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ) AS drivers_paid_count,
    COALESCE((
      SELECT sum(amount) FROM public.payments
      WHERE method = 'moncash' AND status = 'paid'
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ), 0) AS moncash_volume,
    COALESCE((
      SELECT sum(amount) FROM public.payments
      WHERE method = 'kach' AND status = 'paid'
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ), 0) AS cash_volume,
    COALESCE((
      SELECT sum(amount) FROM public.payments
      WHERE method = 'natcash' AND status = 'paid'
        AND (_from IS NULL OR created_at::date >= _from)
        AND (_to IS NULL OR created_at::date <= _to)
    ), 0) AS natcash_volume;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_finance_overview_secure(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_finance_overview_secure(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) get_admin_finance_history_secure — the unified, filterable,
-- paginated cross-entity feed for the "Istorik" tab (commission_ledger
-- + payouts + payments in one chronological list). Deliberately
-- excludes payment_transactions/moncash_webhook_events -- those are
-- sub-events of a payment/payout row already present here at a finer
-- grain, and belong in get_order_financial_timeline_secure's per-order
-- drill-down instead, not duplicated in this list view. The commission
-- branch's derived `status` reuses the exact same CASE logic already
-- shipped in get_restaurant_commissions_secure/get_driver_commissions_secure
-- (reversed / available / partially_paid / covering payout's status) --
-- same rules, just without a beneficiary filter since this is
-- platform-wide. `amount` on the commission branch is
-- commission_amount (the platform's cut), consistent with every other
-- revenue-facing RPC in this codebase.
CREATE FUNCTION public.get_admin_finance_history_secure(
  _search text DEFAULT NULL,
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _amount_min numeric DEFAULT NULL,
  _amount_max numeric DEFAULT NULL,
  _status text DEFAULT NULL,
  _method text DEFAULT NULL,
  _event_type text DEFAULT NULL,
  _sort text DEFAULT 'date_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  event_id text,
  event_date timestamptz,
  event_type text,
  order_id uuid,
  order_number text,
  restaurant_id uuid,
  restaurant_name text,
  driver_id uuid,
  driver_name text,
  amount numeric,
  status text,
  method text,
  reference text,
  description text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    -- Commission ledger entries (order_commission / monthly_fee / reversal)
    SELECT
      'commission:' || cl.id AS event_id,
      cl.created_at AS event_date,
      'commission'::text AS event_type,
      cl.order_id, o.order_number,
      cl.restaurant_id, r.name AS restaurant_name,
      cl.driver_id,
      (CASE WHEN dr.id IS NULL THEN NULL ELSE trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) END) AS driver_name,
      cl.commission_amount AS amount,
      (CASE
        WHEN cl.entry_type = 'reversal' THEN 'reversed'
        WHEN COALESCE(cov.total_covered, 0) = 0 THEN 'available'
        WHEN cov.total_covered < cl.net_amount THEN 'partially_paid'
        ELSE p.status
      END) AS status,
      NULL::text AS method,
      cl.id::text AS reference,
      ('Komisyon — ' || cl.entry_type::text) AS description
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    LEFT JOIN public.restaurants r ON r.id = cl.restaurant_id
    LEFT JOIN public.drivers dr ON dr.id = cl.driver_id
    LEFT JOIN LATERAL (
      SELECT sum(pc.covered_amount) AS total_covered,
        (array_agg(pc.payout_id ORDER BY pc.created_at DESC))[1] AS latest_payout_id
      FROM public.payout_commissions pc
      WHERE pc.commission_ledger_id = cl.id
    ) cov ON true
    LEFT JOIN public.payouts p ON p.id = cov.latest_payout_id

    UNION ALL

    -- Payouts (platform -> restaurant/driver disbursements)
    SELECT
      'payout:' || p.id, p.created_at, 'payout'::text,
      NULL::uuid, NULL::text,
      p.restaurant_id, r.name,
      p.driver_id,
      (CASE WHEN dr.id IS NULL THEN NULL ELSE trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) END),
      p.amount, p.status, p.method,
      p.transaction_reference,
      ('Dekesman ' || p.method)
    FROM public.payouts p
    LEFT JOIN public.restaurants r ON r.id = p.restaurant_id
    LEFT JOIN public.drivers dr ON dr.id = p.driver_id

    UNION ALL

    -- Payments (customer -> platform, manual proof + MonCash automatic collect)
    SELECT
      'payment:' || pm.id, pm.created_at, 'payment'::text,
      pm.order_id, o.order_number,
      o.restaurant_id, r.name,
      d.driver_id,
      (CASE WHEN dr.id IS NULL THEN NULL ELSE trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) END),
      pm.amount, pm.status::text, pm.method::text,
      COALESCE(pm.transaction_ref, pm.id::text),
      'Peman kliyan'::text
    FROM public.payments pm
    JOIN public.orders o ON o.id = pm.order_id
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
    LEFT JOIN public.deliveries d ON d.order_id = pm.order_id
    LEFT JOIN public.drivers dr ON dr.id = d.driver_id
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.order_number ILIKE '%' || _search || '%'
      OR b.restaurant_name ILIKE '%' || _search || '%'
      OR b.driver_name ILIKE '%' || _search || '%'
      OR b.reference ILIKE '%' || _search || '%')
    AND (_restaurant_id IS NULL OR b.restaurant_id = _restaurant_id)
    AND (_driver_id IS NULL OR b.driver_id = _driver_id)
    AND (_from IS NULL OR b.event_date::date >= _from)
    AND (_to IS NULL OR b.event_date::date <= _to)
    AND (_amount_min IS NULL OR b.amount >= _amount_min)
    AND (_amount_max IS NULL OR b.amount <= _amount_max)
    AND (_status IS NULL OR b.status = _status)
    AND (_method IS NULL OR b.method = _method)
    AND (_event_type IS NULL OR b.event_type = _event_type)
  ORDER BY
    CASE WHEN _sort = 'date_asc' THEN b.event_date END ASC NULLS LAST,
    CASE WHEN _sort = 'amount_desc' THEN b.amount END DESC NULLS LAST,
    CASE WHEN _sort = 'amount_asc' THEN b.amount END ASC NULLS LAST,
    b.event_date DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_finance_history_secure(text, uuid, uuid, date, date, numeric, numeric, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_finance_history_secure(text, uuid, uuid, date, date, numeric, numeric, text, text, text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) get_order_financial_timeline_secure — the per-order drill-down for
-- the "Istorik" tab's row-click dialog: walks order -> commission_ledger
-- -> wallet_transactions -> payout_commissions -> payouts, and
-- separately order -> payments -> payment_transactions, into one
-- chronological trace. `payout_coverage.amount` is the commission's
-- covered_amount, never the payout's own total (a payout can cover
-- several orders' commissions at once) -- the description spells out
-- "X sur Y total" explicitly so this is never misread. The
-- moncash_webhook branch is a best-effort text match on
-- transaction_reference (no direct FK from moncash_webhook_events to
-- payouts exists in the schema).
CREATE FUNCTION public.get_order_financial_timeline_secure(_order_id uuid)
RETURNS TABLE (
  event_id text,
  event_time timestamptz,
  category text,
  beneficiary_type text,
  beneficiary_name text,
  amount numeric,
  status text,
  method text,
  reference text,
  description text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _order_id IS NULL THEN
    RAISE EXCEPTION 'Order id required';
  END IF;

  RETURN QUERY
  SELECT
    'order:' || o.id, o.created_at, 'order'::text,
    NULL::text, NULL::text,
    o.total, o.status::text, NULL::text, o.order_number,
    ('Kòmand kreye — ' || o.order_number)
  FROM public.orders o
  WHERE o.id = _order_id

  UNION ALL

  SELECT
    'commission:' || cl.id, cl.created_at, 'commission'::text,
    (CASE WHEN cl.restaurant_id IS NOT NULL THEN 'restaurant' ELSE 'driver' END),
    COALESCE(r.name, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, ''))),
    cl.commission_amount, NULL::text, NULL::text, cl.id::text, cl.entry_type::text
  FROM public.commission_ledger cl
  LEFT JOIN public.restaurants r ON r.id = cl.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = cl.driver_id
  WHERE cl.order_id = _order_id

  UNION ALL

  SELECT
    'wallet_tx:' || wt.id, wt.created_at, 'wallet_transaction'::text,
    (CASE WHEN w.restaurant_id IS NOT NULL THEN 'restaurant' ELSE 'driver' END),
    COALESCE(r.name, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, ''))),
    (wt.available_delta + wt.pending_delta), NULL::text, NULL::text, wt.id::text, wt.type
  FROM public.wallet_transactions wt
  JOIN public.wallets w ON w.id = wt.wallet_id
  LEFT JOIN public.restaurants r ON r.id = w.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = w.driver_id
  WHERE wt.commission_ledger_id IN (SELECT id FROM public.commission_ledger WHERE order_id = _order_id)

  UNION ALL

  SELECT
    'payout_coverage:' || pc.payout_id || ':' || pc.commission_ledger_id, pc.created_at, 'payout_coverage'::text,
    (CASE WHEN p.restaurant_id IS NOT NULL THEN 'restaurant' ELSE 'driver' END),
    COALESCE(r.name, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, ''))),
    pc.covered_amount, p.status, p.method, p.transaction_reference,
    ('Kouvri pa dekesman ' || p.id || ' (' || pc.covered_amount || ' sou ' || p.amount || ' total)')
  FROM public.payout_commissions pc
  JOIN public.payouts p ON p.id = pc.payout_id
  LEFT JOIN public.restaurants r ON r.id = p.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = p.driver_id
  WHERE pc.commission_ledger_id IN (SELECT id FROM public.commission_ledger WHERE order_id = _order_id)

  UNION ALL

  SELECT
    'moncash_webhook:' || mwe.id, mwe.received_at, 'moncash_webhook'::text,
    NULL::text, NULL::text, NULL::numeric, mwe.status, NULL::text, mwe.transaction_reference, mwe.outcome
  FROM public.moncash_webhook_events mwe
  WHERE mwe.transaction_reference IN (
    SELECT p.transaction_reference FROM public.payouts p
    JOIN public.payout_commissions pc ON pc.payout_id = p.id
    WHERE pc.commission_ledger_id IN (SELECT id FROM public.commission_ledger WHERE order_id = _order_id)
  )

  UNION ALL

  SELECT
    'payment:' || pm.id, pm.created_at, 'payment'::text,
    'platform'::text, NULL::text, pm.amount, pm.status::text, pm.method::text,
    COALESCE(pm.transaction_ref, pm.id::text), 'Peman kliyan'::text
  FROM public.payments pm
  WHERE pm.order_id = _order_id

  UNION ALL

  SELECT
    'payment_tx:' || pt.id, pt.created_at, 'payment_transaction'::text,
    'platform'::text, NULL::text, pt.amount, pt.status, NULL::text, pt.external_reference,
    COALESCE(pt.error, 'Kolekte otomatik')
  FROM public.payment_transactions pt
  WHERE pt.order_id = _order_id

  -- Positional reference, not the column name: Postgres only accepts a
  -- result-column name in a UNION ALL's trailing ORDER BY when the
  -- first branch explicitly aliases it that way, which none of these
  -- branches do (their aliases only take effect via RETURNS TABLE at
  -- the function boundary, not inside the union itself) -- "2" is
  -- event_time in every branch above.
  ORDER BY 2 ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_financial_timeline_secure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_financial_timeline_secure(uuid) TO authenticated;
