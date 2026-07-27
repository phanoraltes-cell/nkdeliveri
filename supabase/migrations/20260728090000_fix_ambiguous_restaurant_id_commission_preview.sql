-- CRITICAL bug found during the database-optimization/backfill audit
-- (2026-07-28), before any backfill preview could even run:
-- private.compute_order_commission_preview's RETURNS TABLE declares a
-- column named `restaurant_id` (line 54 of
-- 20260722120000_backfill_runs_and_commission_refactor.sql) -- per
-- PL/pgSQL semantics, every RETURNS TABLE output column is also an
-- implicitly-declared variable in scope for the whole function body. The
-- lookup `WHERE restaurant_id = v_order.restaurant_id` against
-- restaurant_payout_details (which also has a column named
-- restaurant_id) is therefore genuinely ambiguous to Postgres -- it
-- can't tell if the bare `restaurant_id` means the table column or the
-- output-table variable -- and raises 42702 on every call.
--
-- This function is called by BOTH private.generate_commission_for_order
-- (used by the live trg_generate_commission_on_delivery trigger on every
-- real delivery) and the Backfill Wizard's scan/preview RPCs -- so this
-- bug would have silently broken commission generation (and, since an
-- unhandled trigger exception aborts the whole triggering transaction,
-- broken the delivery-status-update itself) for the very next order
-- delivered in production. It was never actually hit live because no
-- order has been delivered since the commission engine's 2026-07-22
-- deployment -- the 3 orders needing backfill all predate it. No
-- financial data was ever corrupted by this; it's fixed here before it
-- could be.
--
-- Fix: qualify the table column explicitly. No change to the commission
-- formula itself -- every other identifier in this function was already
-- unambiguous (table-aliased in the driver lookup, v_-prefixed
-- variables elsewhere).
CREATE OR REPLACE FUNCTION private.compute_order_commission_preview(_order_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  restaurant_commission_rate numeric,
  restaurant_commission_amount numeric,
  restaurant_net_amount numeric,
  driver_id uuid,
  driver_commission_rate numeric,
  driver_fee numeric,
  driver_commission_amount numeric,
  driver_net_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_type text;
  v_rate numeric;
  v_commission numeric;
  v_net numeric;
  v_driver_id uuid;
  v_driver_rate numeric;
  v_fee numeric;
  v_driver_commission numeric;
  v_driver_net numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT rpd.commission_type, rpd.commission_rate INTO v_type, v_rate
  FROM public.restaurant_payout_details rpd WHERE rpd.restaurant_id = v_order.restaurant_id;
  v_type := COALESCE(v_type, 'per_order');
  v_rate := COALESCE(v_rate, 10);

  IF v_type = 'monthly' THEN
    v_commission := 0;
    v_net := v_order.subtotal;
    v_rate := NULL;
  ELSE
    v_commission := ROUND(v_order.subtotal * v_rate / 100, 2);
    v_net := v_order.subtotal - v_commission;
  END IF;

  SELECT dr.id, dr.commission_rate, d.fee INTO v_driver_id, v_driver_rate, v_fee
  FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.order_id = v_order.id AND d.driver_id IS NOT NULL;

  IF FOUND THEN
    v_driver_net := ROUND(v_fee * v_driver_rate / 100, 2);
    v_driver_commission := v_fee - v_driver_net;
  END IF;

  RETURN QUERY SELECT
    v_order.restaurant_id, v_rate, v_commission, v_net,
    v_driver_id, v_driver_rate, v_fee, v_driver_commission, v_driver_net;
END;
$$;
REVOKE ALL ON FUNCTION private.compute_order_commission_preview(uuid) FROM PUBLIC, anon, authenticated;
