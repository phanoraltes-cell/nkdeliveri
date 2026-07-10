-- Restaurant staff ("Anplwaye") feature. The dashboard has had a dead
-- "Anplwaye" tile (to: null, renders "Byento") since it was built. The
-- app_role enum already has 'restaurant_staff' and a restaurant_employees
-- table already existed (20260703055033) with correct shape and owner-only
-- RLS — but nothing in the app ever wrote to it or checked it. This wires it
-- up end to end: owner adds staff by email of an existing account; staff get
-- Kòmand + Meni access only (not payouts/profile/promotions/revenue).

-- ---------------------------------------------------------------------------
-- 1) Additive helper — do NOT touch is_restaurant_manager itself, since it
--    also gates payout/profile/promotions/revenue RPCs that staff must not
--    reach. This new function is owner/admin (via is_restaurant_manager) OR
--    an active restaurant_employees row.
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
    );
$$;

-- ---------------------------------------------------------------------------
-- 2) Menu category / product RPCs: swap the guard to the staff-inclusive
--    helper. Every other line is unchanged from the current live definitions
--    (20260704120500 for categories, 20260706151929 for products with
--    stock_quantity).
CREATE OR REPLACE FUNCTION public.create_menu_category_secure(_restaurant_id uuid, _name text, _sort_order int DEFAULT 0)
RETURNS public.menu_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.menu_categories;
BEGIN
  IF NOT private.is_restaurant_staff_or_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;
  INSERT INTO public.menu_categories (restaurant_id, name, sort_order)
  VALUES (_restaurant_id, btrim(_name), _sort_order)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_menu_category_secure(_category_id uuid, _name text, _sort_order int)
RETURNS public.menu_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.menu_categories;
BEGIN
  SELECT * INTO v_row FROM public.menu_categories WHERE id = _category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF NOT private.is_restaurant_staff_or_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;
  UPDATE public.menu_categories SET name = btrim(_name), sort_order = _sort_order
  WHERE id = _category_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_menu_category_secure(_category_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM public.menu_categories WHERE id = _category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF NOT private.is_restaurant_staff_or_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.menu_categories WHERE id = _category_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_product_secure(
  _restaurant_id uuid, _category_id uuid, _name text, _description text,
  _price numeric, _image_url text, _dish_type text, _stock_quantity integer DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  IF NOT private.is_restaurant_staff_or_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _stock_quantity IS NOT NULL AND _stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = _restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  INSERT INTO public.products (restaurant_id, category_id, name, description, price, image_url, dish_type, stock_quantity)
  VALUES (_restaurant_id, _category_id, btrim(_name), _description, _price, _image_url, _dish_type, _stock_quantity)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_secure(
  _product_id uuid, _name text, _description text, _price numeric,
  _image_url text, _dish_type text, _category_id uuid, _available boolean,
  _stock_quantity integer DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dish not found'; END IF;
  IF NOT private.is_restaurant_staff_or_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _stock_quantity IS NOT NULL AND _stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = v_row.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  UPDATE public.products SET
    name = btrim(_name), description = _description, price = _price, image_url = _image_url,
    dish_type = _dish_type, category_id = _category_id, available = _available,
    stock_quantity = _stock_quantity, updated_at = now()
  WHERE id = _product_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_product_secure(_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dish not found'; END IF;
  IF NOT private.is_restaurant_staff_or_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.products SET archived_at = now(), available = false WHERE id = _product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Orders access for staff: two spots that check ownership inline rather
--    than through is_restaurant_manager.
DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = customer_id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = orders.restaurant_id AND e.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
               WHERE d.order_id = orders.id AND dr.user_id = auth.uid())
    OR (
      orders.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = orders.id)
      AND EXISTS (SELECT 1 FROM public.drivers WHERE user_id = auth.uid() AND status = 'online')
    ));

CREATE OR REPLACE FUNCTION private.update_order_status_secure(
  _order_id uuid,
  _new_status public.order_status
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_is_admin boolean;
  v_is_restaurant_owner boolean;
  v_is_assigned_driver boolean;
  v_allowed boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_is_admin := public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin');
  v_is_restaurant_owner := EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id = v_user
  ) OR EXISTS (
    SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = v_order.restaurant_id AND e.user_id = v_user
  );
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.order_id = v_order.id AND dr.user_id = v_user
  );

  IF NOT (v_is_admin OR v_is_restaurant_owner OR v_is_assigned_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_admin THEN
    v_allowed := true;
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
  ELSIF v_is_assigned_driver THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('ready','assigned'), ('assigned','picked_up'), ('picked_up','delivered')
    );
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Illegal status transition: % -> %', v_order.status, _new_status;
  END IF;

  UPDATE public.orders
     SET status = _new_status,
         status_history = status_history || jsonb_build_object(
           'from', v_order.status, 'to', _new_status,
           'by', v_user, 'at', now()
         ),
         updated_at = now()
   WHERE id = _order_id
   RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Employee management RPCs — owner/admin only (is_restaurant_manager),
--    so staff can never manage other staff.
CREATE OR REPLACE FUNCTION public.add_restaurant_employee_secure(_restaurant_id uuid, _email text)
RETURNS public.restaurant_employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_owner_id uuid;
  v_row public.restaurant_employees;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
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
  VALUES (_restaurant_id, v_target_user_id, 'staff')
  RETURNING * INTO v_row;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_target_user_id, 'restaurant_staff')
  ON CONFLICT DO NOTHING;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_restaurant_employee_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_restaurant_employee_secure(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_restaurant_employee_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_user_id uuid;
BEGIN
  SELECT restaurant_id, user_id INTO v_restaurant_id, v_user_id
  FROM public.restaurant_employees WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT private.is_restaurant_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.restaurant_employees WHERE id = _id;

  -- Only strip the global restaurant_staff role if they don't staff another
  -- restaurant too — the role isn't restaurant-scoped, so it must stay if so.
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_employees WHERE user_id = v_user_id) THEN
    DELETE FROM public.user_roles WHERE user_id = v_user_id AND role = 'restaurant_staff';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_restaurant_employee_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_restaurant_employee_secure(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_restaurant_employees_secure(_restaurant_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
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
  SELECT e.id, e.user_id, u.email::text, p.first_name, p.last_name, e.created_at
  FROM public.restaurant_employees e
  JOIN auth.users u ON u.id = e.user_id
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE e.restaurant_id = _restaurant_id
  ORDER BY e.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_restaurant_employees_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_restaurant_employees_secure(uuid) TO authenticated;
