-- Phase 5, item 6: extend restaurant_employees beyond the single "staff"
-- role. restaurant_employees.role was already free text with no CHECK
-- constraint — this adds one and teaches the RPCs about the new values.
-- The global app_role enum's flat 'restaurant_staff' value is untouched:
-- it's a separate, coarser concept (does this account work at *a*
-- restaurant at all) from this per-row, per-restaurant role.

ALTER TABLE public.restaurant_employees
  ADD CONSTRAINT restaurant_employees_role_check
  CHECK (role IN ('staff', 'manager', 'cook', 'prep', 'cashier', 'supervisor'));

-- ---------------------------------------------------------------------------
-- 1) Menu/product editing narrows to the "management-capable" roles.
--    Every restaurant_employees row already reaches this helper today (all
--    existing rows are 'staff', which stays included), so this is a genuine
--    new restriction only for the newly-introduced operational roles
--    (cook/prep/cashier) — not a behavior change for anyone currently in
--    the system. Order-status transitions (update_order_status_secure) and
--    orders RLS intentionally still check "any employee row", unchanged:
--    every role needs the Kanban/kitchen-ticket workflow.
CREATE OR REPLACE FUNCTION private.is_restaurant_staff_or_manager(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.is_restaurant_manager(_restaurant_id)
    OR EXISTS (
      SELECT 1 FROM public.restaurant_employees e
      WHERE e.restaurant_id = _restaurant_id AND e.user_id = auth.uid()
        AND e.role IN ('staff', 'manager', 'supervisor')
    );
$$;

-- ---------------------------------------------------------------------------
-- 2) Invitations now choose a role (still owner/manager-only, still rate
--    limited identically to the live version) — signature changes
--    (uuid, text) -> (uuid, text, text), so the old overload must be
--    dropped first per this project's documented CREATE OR REPLACE hazard.
DROP FUNCTION IF EXISTS public.add_restaurant_employee_secure(uuid, text);

CREATE OR REPLACE FUNCTION public.add_restaurant_employee_secure(
  _restaurant_id uuid, _email text, _role text DEFAULT 'staff'
)
RETURNS public.restaurant_employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_owner_id uuid;
  v_role text := COALESCE(NULLIF(btrim(_role), ''), 'staff');
  v_row public.restaurant_employees;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('staff', 'manager', 'cook', 'prep', 'cashier', 'supervisor') THEN
    RAISE EXCEPTION 'Wòl envalid';
  END IF;

  IF NOT public.check_rate_limit_secure('add_restaurant_employee', 10, 3600) THEN
    RAISE EXCEPTION 'Twòp envitasyon nan yon ti tan. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  SELECT id INTO v_target_user_id FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Pa gen kont ak imèl sa a. Mande moun sa a kreye yon kont NK Deliveri dabò.';
  END IF;

  IF v_target_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Moun sa a se pwopriyetè restoran an deja';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_employees
    WHERE restaurant_id = _restaurant_id AND user_id = v_target_user_id
  ) THEN
    RAISE EXCEPTION 'Moun sa a deja yon anplwaye pou restoran sa a';
  END IF;

  INSERT INTO public.restaurant_employees (restaurant_id, user_id, role)
  VALUES (_restaurant_id, v_target_user_id, v_role)
  RETURNING * INTO v_row;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_target_user_id, 'restaurant_staff')
  ON CONFLICT DO NOTHING;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_restaurant_employee_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_restaurant_employee_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Change an existing employee's role (owner/manager only).
CREATE OR REPLACE FUNCTION public.update_restaurant_employee_role_secure(_id uuid, _role text)
RETURNS public.restaurant_employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_row public.restaurant_employees;
BEGIN
  IF _role NOT IN ('staff', 'manager', 'cook', 'prep', 'cashier', 'supervisor') THEN
    RAISE EXCEPTION 'Wòl envalid';
  END IF;

  SELECT restaurant_id INTO v_restaurant_id FROM public.restaurant_employees WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT private.is_restaurant_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.restaurant_employees SET role = _role WHERE id = _id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_restaurant_employee_role_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_restaurant_employee_role_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Surface the role in the employee list — return type changes (adding a
--    column), which Postgres also requires a drop for.
DROP FUNCTION IF EXISTS public.list_restaurant_employees_secure(uuid);

CREATE OR REPLACE FUNCTION public.list_restaurant_employees_secure(_restaurant_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  role text,
  created_at timestamptz
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
  SELECT e.id, e.user_id, u.email::text, p.first_name, p.last_name, e.role, e.created_at
  FROM public.restaurant_employees e
  JOIN auth.users u ON u.id = e.user_id
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE e.restaurant_id = _restaurant_id
  ORDER BY e.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_restaurant_employees_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_restaurant_employees_secure(uuid) TO authenticated;
