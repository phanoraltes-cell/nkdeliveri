-- Phase 2 of the admin evolution plan: "mini CRM" profiles. Adds the
-- Activité data restaurant/customer profiles were missing (order counts,
-- top products, peak hours, favorite restaurants, last order) — reused
-- via new tabs on the existing detail dialogs rather than new pages.
-- Driver operational stats already exist (get_drivers_admin, Phase 1) —
-- extended here with an optional exact-id filter so the Dekesman page's
-- BeneficiaryDetailDialog can fetch one driver's stats on demand instead
-- of duplicating the aggregation a second time.

CREATE FUNCTION public.get_restaurant_activity_summary(_restaurant_id uuid, _from date, _to date)
RETURNS TABLE (
  orders_received bigint,
  orders_completed bigint,
  orders_cancelled bigint,
  revenue numeric,
  top_products jsonb,
  peak_hours jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT o.id, o.status, o.subtotal, o.created_at
    FROM public.orders o
    WHERE o.restaurant_id = _restaurant_id AND o.created_at::date BETWEEN _from AND _to
  ),
  products AS (
    SELECT oi.product_name, sum(oi.quantity) AS qty
    FROM public.order_items oi
    JOIN scoped s ON s.id = oi.order_id
    GROUP BY oi.product_name
    ORDER BY qty DESC
    LIMIT 5
  ),
  hours AS (
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, count(*) AS cnt
    FROM scoped
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 5
  )
  SELECT
    (SELECT count(*) FROM scoped)::bigint,
    (SELECT count(*) FILTER (WHERE status = 'delivered') FROM scoped)::bigint,
    (SELECT count(*) FILTER (WHERE status = 'cancelled') FROM scoped)::bigint,
    COALESCE((SELECT sum(subtotal) FROM scoped WHERE status = 'delivered'), 0),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', product_name, 'qty', qty)) FROM products), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', hour, 'count', cnt)) FROM hours), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurant_activity_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_activity_summary(uuid, date, date) TO authenticated;

CREATE FUNCTION public.get_customer_activity_summary(_customer_id uuid)
RETURNS TABLE (
  favorite_restaurants jsonb,
  last_order_number text,
  last_order_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    auth.uid() = _customer_id
    OR private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH fav AS (
    SELECT r.name, count(*) AS cnt
    FROM public.orders o
    JOIN public.restaurants r ON r.id = o.restaurant_id
    WHERE o.customer_id = _customer_id AND o.status = 'delivered'
    GROUP BY r.name
    ORDER BY cnt DESC
    LIMIT 5
  ),
  last_ord AS (
    SELECT order_number, created_at FROM public.orders
    WHERE customer_id = _customer_id
    ORDER BY created_at DESC
    LIMIT 1
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'count', cnt)) FROM fav), '[]'::jsonb),
    (SELECT order_number FROM last_ord),
    (SELECT created_at FROM last_ord);
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_activity_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(uuid) TO authenticated;

-- Same signature as 20260722170000_drivers_admin.sql plus one new
-- trailing optional param -- argument list changes, so DROP FUNCTION
-- first (same rule applied everywhere else in this project). All 5
-- existing named-arg call sites (dashboard.admin.drivers.tsx) keep
-- working unmodified since _driver_id defaults to NULL (no filtering,
-- identical behavior to before).
DROP FUNCTION IF EXISTS public.get_drivers_admin(text, text, text, int, int);

CREATE FUNCTION public.get_drivers_admin(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'created_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _driver_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  phone text,
  email text,
  status public.driver_status,
  created_at timestamptz,
  vehicle_type text,
  license_plate text,
  moncash_number text,
  natcash_number text,
  total_deliveries bigint,
  delivered_count bigint,
  cancelled_count bigint,
  success_rate numeric,
  avg_delivery_minutes numeric,
  avg_rating numeric,
  available_balance numeric,
  last_payment_date timestamptz,
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
      dr.id, dr.first_name, dr.last_name, dr.phone, u.email::text AS email,
      dr.status, dr.created_at, dr.vehicle_type, dr.license_plate,
      dr.moncash_number, dr.natcash_number,
      COALESCE(dstats.total_deliveries, 0) AS total_deliveries,
      COALESCE(dstats.delivered_count, 0) AS delivered_count,
      COALESCE(dstats.cancelled_count, 0) AS cancelled_count,
      CASE WHEN COALESCE(dstats.total_deliveries, 0) = 0 THEN NULL
        ELSE ROUND(dstats.delivered_count::numeric / dstats.total_deliveries, 4)
      END AS success_rate,
      dstats.avg_delivery_minutes,
      rstats.avg_rating,
      COALESCE(w.available_balance, 0) AS available_balance,
      pstats.last_payment_date
    FROM public.drivers dr
    JOIN auth.users u ON u.id = dr.user_id
    LEFT JOIN public.wallets w ON w.driver_id = dr.id
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total_deliveries,
        count(*) FILTER (WHERE d.status = 'delivered') AS delivered_count,
        count(*) FILTER (WHERE d.status = 'cancelled') AS cancelled_count,
        AVG(EXTRACT(EPOCH FROM (d.delivered_at - d.assigned_at)) / 60)
          FILTER (WHERE d.status = 'delivered') AS avg_delivery_minutes
      FROM public.deliveries d WHERE d.driver_id = dr.id
    ) dstats ON true
    LEFT JOIN LATERAL (
      SELECT AVG(r.driver_rating) AS avg_rating
      FROM public.reviews r WHERE r.driver_id = dr.id AND r.driver_rating IS NOT NULL
    ) rstats ON true
    LEFT JOIN LATERAL (
      SELECT max(p.created_at) AS last_payment_date FROM public.payouts p
      WHERE p.driver_id = dr.id AND p.status IN ('paid', 'confirmed', 'resolved')
    ) pstats ON true
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_driver_id IS NOT NULL AND b.id = _driver_id)
     OR (_driver_id IS NULL
      AND (_search IS NULL
        OR b.first_name ILIKE '%' || _search || '%'
        OR b.last_name ILIKE '%' || _search || '%'
        OR b.phone ILIKE '%' || _search || '%'
        OR b.email ILIKE '%' || _search || '%')
      AND (_status IS NULL OR b.status::text = _status))
  ORDER BY
    CASE WHEN _sort = 'name_asc' THEN b.first_name END ASC NULLS LAST,
    CASE WHEN _sort = 'rating_desc' THEN b.avg_rating END DESC NULLS LAST,
    CASE WHEN _sort = 'deliveries_desc' THEN b.total_deliveries END DESC NULLS LAST,
    CASE WHEN _sort = 'created_asc' THEN b.created_at END ASC NULLS LAST,
    b.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_drivers_admin(text, text, text, int, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_drivers_admin(text, text, text, int, int, uuid) TO authenticated;
