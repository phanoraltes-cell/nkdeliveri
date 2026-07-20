-- get_restaurant_revenue_summary always computed commission_amount/net_payout
-- as gross_revenue * commission_rate / 100, even for restaurants an admin
-- explicitly configured with commission_type = 'monthly' (flat
-- monthly_commission_amount instead of a per-order percentage, set via
-- update_restaurant_payout_secure). Those restaurants saw a percentage-based
-- figure that had nothing to do with what they're actually billed. Fix:
-- branch on commission_type, same as the payout-settings screen already
-- lets admins configure. monthly_commission_amount is a flat figure
-- independent of the selected date range, not prorated — there's no
-- existing convention for prorating it and the column is defined as a flat
-- amount, so this shows it as configured. Same signature — CREATE OR
-- REPLACE in place.
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
  v_type text;
  v_monthly_amount numeric;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(d.commission_rate, 10), COALESCE(d.commission_type, 'per_order'), d.monthly_commission_amount
  INTO v_rate, v_type, v_monthly_amount
  FROM public.restaurant_payout_details d WHERE d.restaurant_id = _restaurant_id;
  v_rate := COALESCE(v_rate, 10);
  v_type := COALESCE(v_type, 'per_order');

  RETURN QUERY
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE o.status = 'delivered')::bigint,
    count(*) FILTER (WHERE o.status = 'cancelled')::bigint,
    COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0),
    v_rate,
    CASE WHEN v_type = 'monthly' THEN COALESCE(v_monthly_amount, 0)
         ELSE ROUND(COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) * v_rate / 100, 2)
    END,
    CASE WHEN v_type = 'monthly'
         THEN COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) - COALESCE(v_monthly_amount, 0)
         ELSE ROUND(COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) * (100 - v_rate) / 100, 2)
    END,
    COALESCE((SELECT sum(p.amount) FROM public.payments p
              JOIN public.orders oo ON oo.id = p.order_id
              WHERE oo.restaurant_id = _restaurant_id AND p.status = 'paid'
                AND oo.created_at::date BETWEEN _from AND _to), 0),
    COALESCE((SELECT sum(p.amount) FROM public.payments p
              JOIN public.orders oo ON oo.id = p.order_id
              WHERE oo.restaurant_id = _restaurant_id AND p.status IN ('pending', 'awaiting_proof', 'under_review')
                AND oo.created_at::date BETWEEN _from AND _to), 0)
  FROM public.orders o
  WHERE o.restaurant_id = _restaurant_id
    AND o.created_at::date BETWEEN _from AND _to;
END;
$$;
