-- Admin's full driver/restaurant profile dialogs (Jesyon Livrè, Jesyon
-- Restoran/Payouts) never returned the uploaded logo/cover/ID document
-- columns — only the small "pending approval" widget on the admin home
-- dashboard did (it queries the tables directly, not through these RPCs).
-- Once a driver/restaurant is approved, that widget stops showing them at
-- all, leaving admin with no way to re-open the documents afterward. Both
-- functions change their RETURNS TABLE shape, so they must be dropped and
-- recreated rather than CREATE OR REPLACE'd (Postgres rejects an output
-- column change on REPLACE).

DROP FUNCTION IF EXISTS public.get_drivers_admin(text, text, text, int, int, uuid);

CREATE FUNCTION public.get_drivers_admin(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'created_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _driver_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, first_name text, last_name text, phone text, email text,
  status driver_status, created_at timestamptz, vehicle_type text, license_plate text,
  moncash_number text, natcash_number text,
  total_deliveries bigint, delivered_count bigint, cancelled_count bigint,
  success_rate numeric, avg_delivery_minutes numeric, avg_rating numeric,
  available_balance numeric, last_payment_date timestamptz,
  id_doc_url text, license_doc_url text, vehicle_photo_url text,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      pstats.last_payment_date,
      dr.id_doc_url, dr.license_doc_url, dr.vehicle_photo_url
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
$function$;
REVOKE ALL ON FUNCTION public.get_drivers_admin(text, text, text, int, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_drivers_admin(text, text, text, int, int, uuid) TO authenticated;


DROP FUNCTION IF EXISTS public.get_restaurants_admin(int, int);

CREATE FUNCTION public.get_restaurants_admin(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid, name text, status restaurant_status, cuisine text, created_at timestamptz,
  commission_type text, commission_rate numeric, monthly_commission_amount numeric,
  logo_url text, cover_url text,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  SELECT
    r.id, r.name, r.status, r.cuisine, r.created_at,
    COALESCE(d.commission_type, 'per_order'),
    COALESCE(d.commission_rate, 10),
    COALESCE(d.monthly_commission_amount, 0),
    r.logo_url, r.cover_url,
    count(*) OVER()
  FROM public.restaurants r
  LEFT JOIN public.restaurant_payout_details d ON d.restaurant_id = r.id
  ORDER BY r.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_restaurants_admin(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurants_admin(int, int) TO authenticated;
