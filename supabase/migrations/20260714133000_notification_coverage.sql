-- Phase 5, item 7: the `notifications` table existed but almost nothing
-- wrote to it before this session (refunds/disputes, added earlier in this
-- phase, were the first). This closes the remaining gaps named in the audit:
-- order status changes, employee validation, and new promotions — each
-- inserted directly inside the RPC that causes the event, so coverage can
-- never depend on every frontend call-site remembering to fire a
-- notification separately.

-- ---------------------------------------------------------------------------
-- 1) Order status changes (confirmed/preparing/ready/cancelled — the
--    restaurant-driven transitions, which had zero notification coverage;
--    "delivered" already has its own bespoke sendOrderDeliveredPush flow,
--    and "assigned" its own sendDeliveryAssignedPush flow, both unaffected).
--    Same signature as the live version — CREATE OR REPLACE in place.
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
  v_status_label text;
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

  IF _new_status IN ('confirmed', 'preparing', 'ready', 'cancelled') THEN
    v_status_label := CASE _new_status
      WHEN 'confirmed' THEN 'konfime'
      WHEN 'preparing' THEN 'ap prepare'
      WHEN 'ready' THEN 'prè pou livrezon'
      WHEN 'cancelled' THEN 'anile'
    END;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'Kòmand ou a ' || v_status_label,
      'Kòmand ' || v_order.order_number || ' kounye a ' || v_status_label || '.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  END IF;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Employee validation: notify the person being added, and again if their
--    role later changes. Same signatures as the versions just created in
--    20260714132000_employee_roles.sql — CREATE OR REPLACE in place.
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
  v_restaurant_name text;
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

  SELECT owner_id, name INTO v_owner_id, v_restaurant_name
  FROM public.restaurants WHERE id = _restaurant_id;
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

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_target_user_id, 'employee_added', 'Ou vin yon anplwaye',
    'Ou vin yon anplwaye pou ' || COALESCE(v_restaurant_name, 'yon restoran') || '.',
    jsonb_build_object('restaurant_id', _restaurant_id, 'role', v_role)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_restaurant_employee_role_secure(_id uuid, _role text)
RETURNS public.restaurant_employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_restaurant_name text;
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

  SELECT name INTO v_restaurant_name FROM public.restaurants WHERE id = v_restaurant_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.user_id, 'employee_role_changed', 'Wòl ou chanje',
    'Wòl ou pou ' || COALESCE(v_restaurant_name, 'restoran an') || ' vin ' || _role || '.',
    jsonb_build_object('restaurant_id', v_restaurant_id, 'role', _role)
  );

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) New promotions: notify customers who favorited the restaurant. Same
--    signature as the live version — CREATE OR REPLACE in place.
CREATE OR REPLACE FUNCTION public.create_promotion_secure(
  _restaurant_id uuid, _title text, _description text, _discount_type text,
  _discount_value numeric, _code text, _starts_at timestamptz, _ends_at timestamptz
)
RETURNS public.promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.promotions;
  v_restaurant_name text;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Promotion title is required';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Invalid discount type';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Discount value must be greater than zero';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Percentage discount cannot exceed 100';
  END IF;
  INSERT INTO public.promotions (restaurant_id, title, description, discount_type, discount_value, code, starts_at, ends_at)
  VALUES (_restaurant_id, btrim(_title), _description, _discount_type, _discount_value, _code, _starts_at, _ends_at)
  RETURNING * INTO v_row;

  SELECT name INTO v_restaurant_name FROM public.restaurants WHERE id = _restaurant_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT f.user_id, 'new_promotion', 'Nouvo pwomosyon',
    COALESCE(v_restaurant_name, 'Yon restoran ou renmen') || ' gen yon nouvo pwomosyon: ' || btrim(_title) || '.',
    jsonb_build_object('restaurant_id', _restaurant_id, 'promotion_id', v_row.id)
  FROM public.favorites f
  WHERE f.restaurant_id = _restaurant_id;

  RETURN v_row;
END;
$$;
