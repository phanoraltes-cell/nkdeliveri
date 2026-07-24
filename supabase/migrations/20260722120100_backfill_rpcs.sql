-- Backfill Wizard, part 2: the 3 admin-only RPCs behind the "Asistan
-- Migrasyon" wizard (Scan -> Preview -> Confirm -> Execute -> Report).
-- "Unmigrated" is a derived concept, never a stored column: a delivered
-- order qualifies if no commission_ledger row exists yet for its order_id.
-- This filter only drives what the Scan/Preview screens list — the actual
-- no-duplicate guarantee at Execute time comes from the partial unique
-- indexes on commission_ledger and the per-beneficiary idempotence of
-- private.generate_commission_for_order (previous migration), not from
-- this filter's precision.

-- 1) Scan — aggregate totals only, zero writes (STABLE).
CREATE FUNCTION public.get_historical_backfill_summary_secure()
RETURNS TABLE (
  total_orders bigint,
  restaurant_count bigint,
  driver_count bigint,
  estimated_restaurant_earnings numeric,
  estimated_driver_earnings numeric,
  estimated_platform_commission numeric
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
    count(*)::bigint,
    count(DISTINCT calc.restaurant_id)::bigint,
    count(DISTINCT calc.driver_id)::bigint,
    COALESCE(sum(calc.restaurant_net_amount), 0),
    COALESCE(sum(calc.driver_net_amount), 0),
    COALESCE(sum(calc.restaurant_commission_amount), 0) + COALESCE(sum(calc.driver_commission_amount), 0)
  FROM public.orders o
  CROSS JOIN LATERAL private.compute_order_commission_preview(o.id) calc
  WHERE o.status = 'delivered'
    AND NOT EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.order_id = o.id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_historical_backfill_summary_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_historical_backfill_summary_secure() TO authenticated;

-- 2) Preview — paginated/filterable order-by-order detail, zero writes.
CREATE FUNCTION public.get_historical_backfill_preview_secure(
  _search text DEFAULT NULL,
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _sort text DEFAULT 'date_asc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  order_date timestamptz,
  restaurant_id uuid,
  restaurant_name text,
  driver_id uuid,
  driver_name text,
  subtotal numeric,
  delivery_fee numeric,
  restaurant_commission_amount numeric,
  driver_commission_amount numeric,
  platform_commission_amount numeric,
  migration_status text,
  total_count bigint
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
    SELECT
      o.id AS order_id, o.order_number, o.created_at AS order_date,
      o.restaurant_id, r.name AS restaurant_name,
      calc.driver_id, NULLIF(btrim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')), '') AS driver_name,
      o.subtotal, o.delivery_fee,
      calc.restaurant_commission_amount, calc.driver_commission_amount,
      COALESCE(calc.restaurant_commission_amount, 0) + COALESCE(calc.driver_commission_amount, 0) AS platform_commission_amount,
      'pending'::text AS migration_status
    FROM public.orders o
    CROSS JOIN LATERAL private.compute_order_commission_preview(o.id) calc
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
    LEFT JOIN public.drivers dr ON dr.id = calc.driver_id
    WHERE o.status = 'delivered'
      AND NOT EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.order_id = o.id)
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.order_number ILIKE '%' || _search || '%')
    AND (_restaurant_id IS NULL OR b.restaurant_id = _restaurant_id)
    AND (_driver_id IS NULL OR b.driver_id = _driver_id)
    AND (_from IS NULL OR b.order_date::date >= _from)
    AND (_to IS NULL OR b.order_date::date <= _to)
  ORDER BY
    CASE WHEN _sort = 'date_desc' THEN b.order_date END DESC NULLS LAST,
    CASE WHEN _sort = 'amount_desc' THEN b.platform_commission_amount END DESC NULLS LAST,
    b.order_date ASC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_historical_backfill_preview_secure(text, uuid, uuid, date, date, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_historical_backfill_preview_secure(text, uuid, uuid, date, date, text, int, int) TO authenticated;

-- 3) Execute — the only writing RPC. _order_ids NULL migrates every
-- currently-qualifying order; a specific array migrates only that subset.
-- Each order runs inside its own BEGIN/EXCEPTION block (an implicit
-- plpgsql savepoint), so one order's failure cannot roll back orders
-- already migrated earlier in the same call, and is reported individually
-- instead of aborting the batch. Re-running this on the same orders is
-- always safe: an order that already has a commission_ledger row reports
-- 'already_migrated' and writes nothing.
CREATE FUNCTION public.execute_commission_backfill_secure(_order_ids uuid[] DEFAULT NULL)
RETURNS TABLE (order_id uuid, order_number text, outcome text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_run_id uuid;
  v_order record;
  v_outcome text;
  v_detail text;
  v_scanned int := 0;
  v_migrated int := 0;
  v_already int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.backfill_runs (run_by) VALUES (v_user) RETURNING id INTO v_run_id;

  FOR v_order IN
    SELECT o.id, o.order_number, o.status
    FROM public.orders o
    WHERE (_order_ids IS NOT NULL AND o.id = ANY(_order_ids))
       OR (_order_ids IS NULL AND o.status = 'delivered'
           AND NOT EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.order_id = o.id))
    ORDER BY o.created_at ASC
  LOOP
    v_scanned := v_scanned + 1;
    v_outcome := NULL;
    v_detail := NULL;

    BEGIN
      IF EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.order_id = v_order.id) THEN
        v_outcome := 'already_migrated';
        v_already := v_already + 1;
      ELSIF v_order.status <> 'delivered' THEN
        v_outcome := 'skipped';
        v_detail := 'Kòmand pa nan estati "delivered" ankò';
        v_skipped := v_skipped + 1;
      ELSE
        PERFORM private.generate_commission_for_order(v_order.id, v_user, 'backfill');
        v_outcome := 'migrated';
        v_migrated := v_migrated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outcome := 'error';
      v_detail := SQLERRM;
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'error', SQLERRM);
    END;

    RETURN QUERY SELECT v_order.id, v_order.order_number, v_outcome, v_detail;
  END LOOP;

  UPDATE public.backfill_runs SET
    completed_at = now(),
    orders_scanned = v_scanned,
    orders_migrated = v_migrated,
    orders_already_migrated = v_already,
    orders_skipped = v_skipped,
    orders_failed = v_failed,
    error_details = v_errors
  WHERE id = v_run_id;

  PERFORM private.log_audit_event(v_user, 'admin', 'backfill.executed',
    jsonb_build_object('run_id', v_run_id, 'orders_scanned', v_scanned, 'orders_migrated', v_migrated,
      'orders_already_migrated', v_already, 'orders_skipped', v_skipped, 'orders_failed', v_failed));
END;
$$;
REVOKE ALL ON FUNCTION public.execute_commission_backfill_secure(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_commission_backfill_secure(uuid[]) TO authenticated;
