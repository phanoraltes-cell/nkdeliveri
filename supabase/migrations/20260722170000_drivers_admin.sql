-- Phase 1 of the admin evolution plan: "Gestion Livreurs" — no admin page
-- or list RPC for drivers existed before this (confirmed by exhaustive
-- search: the only driver-admin RPC was the 2-arg
-- update_driver_status_secure powering the homepage's pending-drivers
-- approve/reject buttons, and the only driver data admin could see was
-- financial, via get_driver_wallets_admin on the Dekesman page).
--
-- drivers has no denormalized rating/delivery-count/success-rate columns
-- -- all operational stats are computed here from deliveries/reviews,
-- same LATERAL-per-row pattern already used (and already correctly
-- indexed) by get_restaurant_wallets_admin/get_driver_wallets_admin.

CREATE INDEX IF NOT EXISTS deliveries_driver_id_status_idx
  ON public.deliveries (driver_id, status);

CREATE FUNCTION public.get_drivers_admin(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'created_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
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
  WHERE (_search IS NULL
      OR b.first_name ILIKE '%' || _search || '%'
      OR b.last_name ILIKE '%' || _search || '%'
      OR b.phone ILIKE '%' || _search || '%'
      OR b.email ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.status::text = _status)
  ORDER BY
    CASE WHEN _sort = 'name_asc' THEN b.first_name END ASC NULLS LAST,
    CASE WHEN _sort = 'rating_desc' THEN b.avg_rating END DESC NULLS LAST,
    CASE WHEN _sort = 'deliveries_desc' THEN b.total_deliveries END DESC NULLS LAST,
    CASE WHEN _sort = 'created_asc' THEN b.created_at END ASC NULLS LAST,
    b.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_drivers_admin(text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_drivers_admin(text, text, text, int, int) TO authenticated;

-- Extends the existing update_driver_status_secure(uuid, driver_status)
-- (from 20260704180000_...sql, already admin-gated, already the RPC
-- powering the homepage's pending-drivers approve/reject buttons) with an
-- optional reason, a notification to the driver, and an audit_log entry
-- -- none of which it had before. Argument list changes (new trailing
-- param) so the old 2-arg overload must be dropped first (same rule
-- check-migration-hazards.mjs enforces everywhere else in this project);
-- the new third parameter defaults to NULL, so the existing 2-arg call
-- site (dashboard.admin.index.tsx's PendingDriversSection mutation)
-- keeps working unmodified.
DROP FUNCTION IF EXISTS public.update_driver_status_secure(uuid, public.driver_status);

CREATE FUNCTION public.update_driver_status_secure(
  _driver_id uuid, _status public.driver_status, _reason text DEFAULT NULL
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.drivers;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.drivers SET status = _status, updated_at = now()
  WHERE id = _driver_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.user_id, 'driver_status_changed',
    CASE _status
      WHEN 'approved' THEN 'Kont ou apwouve'
      WHEN 'suspended' THEN 'Kont ou sispann'
      WHEN 'rejected' THEN 'Kont ou rejte'
      ELSE 'Estati kont ou chanje'
    END,
    COALESCE(NULLIF(btrim(_reason), ''), 'Yon administratè chanje estati kont ou.'),
    jsonb_build_object('status', _status)
  );

  PERFORM private.log_audit_event(auth.uid(), 'admin', 'driver.status_changed',
    jsonb_build_object('driver_id', _driver_id, 'status', _status, 'reason', _reason));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_driver_status_secure(uuid, public.driver_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_status_secure(uuid, public.driver_status, text) TO authenticated;
