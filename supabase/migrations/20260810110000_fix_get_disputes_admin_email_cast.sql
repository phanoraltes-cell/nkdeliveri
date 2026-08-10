-- Real production incident (2026-08-10): the admin "Litij" page always
-- showed "Pa ka chaje lis litij yo" — get_disputes_admin failed on every
-- call with `structure of query does not match function result type`
-- (SQLSTATE 42804). Root-caused directly: auth.users.email is
-- `character varying`, but the function's RETURNS TABLE declares
-- `assigned_email text` with no cast on `u.email` in the RETURN QUERY
-- SELECT. Confirmed via isolated test: a plain `SELECT u.email INTO
-- some_text_var` succeeds (assignment-cast semantics), but `RETURN QUERY`
-- inside a RETURNS TABLE function enforces an exact column-type match with
-- no implicit varchar->text coercion -- this is the actual reason the two
-- behave differently. get_drivers_admin already has the correct pattern
-- (`u.email::text AS email`,
-- 20260729210000_admin_document_review_columns.sql) -- get_disputes_admin
-- was simply missing the same cast since it was written
-- (20260722210000_disputes_redesign.sql), and had apparently never been
-- exercised with real data (LEFT JOIN auth.users always evaluates u.email
-- in the SELECT list regardless of whether assigned_to is NULL, so this
-- fails on every call, not just when a dispute is actually assigned).
--
-- Same signature (text, text, text, text, int, int) -- safe CREATE OR
-- REPLACE, no DROP needed. Only the one column gets an explicit ::text
-- cast; everything else in the function is byte-identical to the
-- currently-live version.
CREATE OR REPLACE FUNCTION public.get_disputes_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _category_group text DEFAULT NULL,
  _sort text DEFAULT 'created_desc', _limit int DEFAULT 20, _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, category text, category_group text,
  status text, customer_id uuid, restaurant_id uuid, restaurant_name text,
  driver_id uuid, driver_first_name text, driver_last_name text,
  assigned_to uuid, assigned_email text, resolution text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.order_id, o.order_number, d.category, d.category_group, d.status,
    d.customer_id, d.restaurant_id, r.name, d.driver_id, dr.first_name, dr.last_name,
    d.assigned_to, u.email::text, d.resolution, d.created_at, d.updated_at,
    count(*) OVER() AS total_count
  FROM public.disputes d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.restaurants r ON r.id = d.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = d.driver_id
  LEFT JOIN auth.users u ON u.id = d.assigned_to
  WHERE (_status IS NULL OR _status = '' OR d.status = _status)
    AND (_category_group IS NULL OR _category_group = '' OR d.category_group = _category_group)
    AND (
      _search IS NULL OR _search = ''
      OR o.order_number ILIKE '%' || _search || '%'
      OR r.name ILIKE '%' || _search || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'created_asc' THEN d.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'updated_desc' THEN d.updated_at END DESC NULLS LAST,
    d.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
-- Same signature as before -- no DROP/GRANT changes needed.
