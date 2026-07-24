-- Fixes 2 confirmed calculation-divergence bugs found during the UI/RLS
-- audit: get_restaurant_revenue_summary computed on orders.total instead
-- of orders.subtotal (bundling delivery_fee/service_fee into "the
-- restaurant's revenue", which the Commission Engine never does), and
-- get_driver_earnings_summary ignored drivers.commission_rate entirely
-- (summed the raw delivery fee, invisible today only because both real
-- drivers happen to be at commission_rate = 100).
--
-- Fix strategy: neither function recomputes the commission formula.
-- Both now read directly from commission_ledger -- the table the
-- Commission Engine itself writes to (via
-- private.generate_commission_for_order, shared by the delivery trigger
-- and the Backfill Wizard). This is stronger than re-invoking
-- private.compute_order_commission_preview() at read time would have
-- been: recomputing "live" would use the beneficiary's *current*
-- commission_rate for historical orders too, silently rewriting history
-- the moment a rate changes -- exactly what "historical commissions must
-- remain immutable" forbids. Reading the ledger's own already-snapshotted
-- commission_rate/net_amount per row is the only approach that can never
-- diverge from what was actually charged, now or in the future, and
-- guarantees these two summary screens can never disagree with
-- Commission Ledger, Wallet, or the "Mes Komisyon" pages -- one single
-- source of truth, zero duplicated business logic.
--
-- Same signatures/return shapes as before -- CREATE OR REPLACE in place,
-- no DROP FUNCTION needed.

CREATE OR REPLACE FUNCTION public.get_restaurant_revenue_summary(_restaurant_id uuid, _from date, _to date)
RETURNS TABLE (
  total_orders bigint,
  delivered_orders bigint,
  cancelled_orders bigint,
  gross_revenue numeric,
  commission_rate numeric,
  commission_amount numeric,
  net_payout numeric,
  paid_amount numeric,
  pending_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Current configured rate, shown for reference only ("what am I charged
  -- today") -- never used to compute the amounts below, which come
  -- entirely from the ledger's own historical snapshots.
  SELECT COALESCE(d.commission_rate, 10) INTO v_rate
  FROM public.restaurant_payout_details d WHERE d.restaurant_id = _restaurant_id;
  v_rate := COALESCE(v_rate, 10);

  RETURN QUERY
  WITH order_stats AS (
    SELECT
      count(*)::bigint AS total_orders,
      count(*) FILTER (WHERE o.status = 'delivered')::bigint AS delivered_orders,
      count(*) FILTER (WHERE o.status = 'cancelled')::bigint AS cancelled_orders
    FROM public.orders o
    WHERE o.restaurant_id = _restaurant_id AND o.created_at::date BETWEEN _from AND _to
  ),
  ledger_stats AS (
    -- Attributed to the order's own date whenever the ledger row has one
    -- (order_commission/reversal always do) so a historical order
    -- migrated by the Backfill Wizard reports under the period it was
    -- actually delivered in, not the period it happened to be backfilled
    -- in. Only entry_type = 'monthly_fee' (no order_id) falls back to its
    -- own created_at.
    SELECT
      COALESCE(sum(cl.gross_amount) FILTER (WHERE cl.entry_type = 'order_commission'), 0) AS gross_revenue,
      COALESCE(sum(cl.commission_amount), 0) AS commission_amount,
      COALESCE(sum(cl.net_amount), 0) AS net_payout
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o2 ON o2.id = cl.order_id
    WHERE cl.restaurant_id = _restaurant_id
      AND COALESCE(o2.created_at::date, cl.created_at::date) BETWEEN _from AND _to
  ),
  payment_stats AS (
    SELECT
      COALESCE(sum(p.amount) FILTER (WHERE p.status = 'paid'), 0) AS paid_amount,
      COALESCE(sum(p.amount) FILTER (WHERE p.status IN ('pending', 'awaiting_proof', 'under_review')), 0) AS pending_amount
    FROM public.payments p
    JOIN public.orders oo ON oo.id = p.order_id
    WHERE oo.restaurant_id = _restaurant_id AND oo.created_at::date BETWEEN _from AND _to
  )
  SELECT
    order_stats.total_orders, order_stats.delivered_orders, order_stats.cancelled_orders,
    ledger_stats.gross_revenue, v_rate, ledger_stats.commission_amount, ledger_stats.net_payout,
    payment_stats.paid_amount, payment_stats.pending_amount
  FROM order_stats, ledger_stats, payment_stats;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_driver_earnings_summary(_driver_id uuid, _from date, _to date)
RETURNS TABLE (
  total_deliveries bigint,
  total_earnings numeric,
  week_start date,
  week_earnings numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND user_id = auth.uid())
    OR private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH d AS (
    -- net_amount is the ledger's own snapshot of fee * commission_rate/100
    -- at the time it was earned (private.compute_order_commission_preview,
    -- via the same generate_commission_for_order the Backfill Wizard
    -- calls) -- never the raw fee, and never recomputed against the
    -- driver's *current* rate. Reversal rows (refunded deliveries) are
    -- included too, with their already-negative net_amount, so a refund
    -- correctly reduces displayed earnings exactly as it already reduces
    -- the wallet -- the original version never accounted for refunds at
    -- all.
    SELECT
      cl.order_id, cl.entry_type, cl.net_amount AS earnings,
      date_trunc('week', COALESCE(o.created_at, cl.created_at))::date AS wk
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    WHERE cl.driver_id = _driver_id
      AND cl.entry_type IN ('order_commission', 'reversal')
      AND COALESCE(o.created_at::date, cl.created_at::date) BETWEEN _from AND _to
  )
  SELECT
    (SELECT count(*) FROM d WHERE entry_type = 'order_commission')::bigint,
    (SELECT COALESCE(sum(earnings), 0) FROM d),
    wk,
    sum(earnings)
  FROM d
  GROUP BY wk
  ORDER BY wk;
END;
$$;
