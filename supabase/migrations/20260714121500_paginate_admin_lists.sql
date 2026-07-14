-- Performance remediation (Phase 3, item 5): get_all_users_admin,
-- get_customers_admin and get_restaurants_admin have never had a LIMIT —
-- each returns every matching row in one call, so the admin Users/
-- Customers/Restaurants dashboards load the entire table on every visit
-- and will get slower in direct proportion to how many accounts sign up.
--
-- Adds _limit/_offset (both DEFAULTed, so existing behavior is unchanged
-- for any caller that doesn't pass them) and a total_count column (via
-- count(*) OVER(), evaluated over the filtered/grouped rows before LIMIT
-- applies) so the UI can render "page X sou Y" and disable Next correctly.
--
-- Each function's signature is changing (new parameters), which — per the
-- documented lesson in 20260709070000_fix_menu_overload_and_commission_admin.sql
-- — means CREATE OR REPLACE alone would create a second overload instead of
-- replacing the function. DROP FUNCTION first, exactly like that fix and
-- 20260712120000_add_driver_payout_account_names.sql did.

-- _role is new too: the admin Users page previously filtered by role
-- client-side, after fetching everything. Once the fetch itself is paged,
-- a client-side-only filter would silently only search the current page —
-- so role filtering has to move server-side to stay correct alongside
-- pagination.
DROP FUNCTION IF EXISTS public.get_all_users_admin(text);
CREATE FUNCTION public.get_all_users_admin(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _role public.app_role DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  roles text[],
  banned_until timestamptz,
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
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.created_at,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]),
    u.banned_until,
    count(*) OVER()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE (
    _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  )
  AND (
    _role IS NULL
    OR EXISTS (SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = p.id AND ur2.role = _role)
  )
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.created_at, u.banned_until
  ORDER BY p.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) TO authenticated;

DROP FUNCTION IF EXISTS public.get_customers_admin(text);
CREATE FUNCTION public.get_customers_admin(_search text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  address text,
  created_at timestamptz,
  total_orders bigint,
  total_spent numeric,
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
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.address,
    p.created_at,
    COUNT(o.id)::bigint,
    COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0),
    count(*) OVER()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'customer'
  LEFT JOIN public.orders o ON o.customer_id = p.id
  WHERE _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.address, p.created_at
  ORDER BY p.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customers_admin(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_admin(text, int, int) TO authenticated;

DROP FUNCTION IF EXISTS public.get_restaurants_admin();
CREATE FUNCTION public.get_restaurants_admin(_limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (
  id uuid,
  name text,
  status public.restaurant_status,
  cuisine text,
  created_at timestamptz,
  commission_type text,
  commission_rate numeric,
  monthly_commission_amount numeric,
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
  SELECT
    r.id, r.name, r.status, r.cuisine, r.created_at,
    COALESCE(d.commission_type, 'per_order'),
    COALESCE(d.commission_rate, 10),
    COALESCE(d.monthly_commission_amount, 0),
    count(*) OVER()
  FROM public.restaurants r
  LEFT JOIN public.restaurant_payout_details d ON d.restaurant_id = r.id
  ORDER BY r.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurants_admin(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurants_admin(int, int) TO authenticated;
