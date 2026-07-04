-- Restaurant dashboard: secure RPCs for every write operation, and lockdown of
-- the tables they replace. No business logic (pricing, authorization, status
-- transitions) is left for the client to perform.

-- ---------------------------------------------------------------------------
-- 0) Close a self-approval hole found while wiring this up: "Owner or admin
--    updates restaurant" has no column restriction, so a restaurant owner can
--    currently set their own status to 'approved' directly via the Data API,
--    bypassing admin review entirely. Lock the table down the same way
--    orders/payments were locked down, and move every legitimate write behind
--    a validated RPC.
REVOKE INSERT, UPDATE, DELETE ON public.restaurants FROM authenticated;
DROP POLICY IF EXISTS "Owner or admin updates restaurant" ON public.restaurants;
DROP POLICY IF EXISTS "Auth users create restaurant" ON public.restaurants;
-- "Approved restaurants viewable by all" (SELECT) and "Admin deletes restaurant"
-- stay as-is; restaurant creation still happens via handle_new_user (SECURITY
-- DEFINER trigger), which is unaffected by this grant change.

REVOKE INSERT, UPDATE, DELETE ON public.products FROM authenticated;
DROP POLICY IF EXISTS "Owner/admin manage products" ON public.products;

REVOKE INSERT, UPDATE, DELETE ON public.menu_categories FROM authenticated;
DROP POLICY IF EXISTS "Owner/admin manage categories" ON public.menu_categories;

REVOKE INSERT, UPDATE, DELETE ON public.restaurant_payout_details FROM authenticated;

-- ---------------------------------------------------------------------------
-- Shared authorization helper: is the caller the owner of this restaurant, or
-- an admin? Used by every RPC below.
CREATE OR REPLACE FUNCTION private.is_restaurant_manager(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = _restaurant_id AND r.owner_id = auth.uid()
  ) OR private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin');
$$;
REVOKE ALL ON FUNCTION private.is_restaurant_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_restaurant_manager(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1) Menu categories
CREATE OR REPLACE FUNCTION public.create_menu_category_secure(_restaurant_id uuid, _name text, _sort_order int DEFAULT 0)
RETURNS public.menu_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.menu_categories;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
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
  IF NOT private.is_restaurant_manager(v_row.restaurant_id) THEN
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
  IF NOT private.is_restaurant_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- products.category_id is ON DELETE SET NULL — dishes are kept, just uncategorized.
  DELETE FROM public.menu_categories WHERE id = _category_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Products
CREATE OR REPLACE FUNCTION public.create_product_secure(
  _restaurant_id uuid, _category_id uuid, _name text, _description text,
  _price numeric, _image_url text, _dish_type text
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = _restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  INSERT INTO public.products (restaurant_id, category_id, name, description, price, image_url, dish_type)
  VALUES (_restaurant_id, _category_id, btrim(_name), _description, _price, _image_url, _dish_type)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_secure(
  _product_id uuid, _name text, _description text, _price numeric,
  _image_url text, _dish_type text, _category_id uuid, _available boolean
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
  IF NOT private.is_restaurant_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = v_row.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  UPDATE public.products SET
    name = btrim(_name), description = _description, price = _price, image_url = _image_url,
    dish_type = _dish_type, category_id = _category_id, available = _available, updated_at = now()
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
  IF NOT private.is_restaurant_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- Soft delete: past order_items reference this row, so it can never be hard-
  -- deleted once ordered. Archiving hides it from the menu without breaking history.
  UPDATE public.products SET archived_at = now(), available = false WHERE id = _product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Promotions
CREATE OR REPLACE FUNCTION public.create_promotion_secure(
  _restaurant_id uuid, _title text, _description text, _discount_type text,
  _discount_value numeric, _code text, _starts_at timestamptz, _ends_at timestamptz
)
RETURNS public.promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promotions;
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
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_promotion_secure(
  _promotion_id uuid, _title text, _description text, _discount_type text,
  _discount_value numeric, _code text, _starts_at timestamptz, _ends_at timestamptz, _active boolean
)
RETURNS public.promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promotions;
BEGIN
  SELECT * INTO v_row FROM public.promotions WHERE id = _promotion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion not found'; END IF;
  IF NOT private.is_restaurant_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
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
  UPDATE public.promotions SET
    title = btrim(_title), description = _description, discount_type = _discount_type,
    discount_value = _discount_value, code = _code, starts_at = _starts_at, ends_at = _ends_at, active = _active
  WHERE id = _promotion_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_promotion_secure(_promotion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM public.promotions WHERE id = _promotion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion not found'; END IF;
  IF NOT private.is_restaurant_manager(v_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.promotions WHERE id = _promotion_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Restaurant profile, hours, payout config (owner) and status (admin)
CREATE OR REPLACE FUNCTION public.update_restaurant_profile_secure(
  _restaurant_id uuid, _name text, _description text, _cuisine text,
  _phone text, _address text, _logo_url text, _cover_url text
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurants;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Restaurant name is required';
  END IF;
  UPDATE public.restaurants SET
    name = btrim(_name), description = _description, cuisine = _cuisine, phone = _phone,
    address = _address,
    logo_url = COALESCE(_logo_url, logo_url),
    cover_url = COALESCE(_cover_url, cover_url)
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_restaurant_hours_secure(_restaurant_id uuid, _opening_hours jsonb)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurants;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.restaurants SET opening_hours = _opening_hours
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_restaurant_status_secure(_restaurant_id uuid, _status public.restaurant_status)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurants;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.restaurants SET status = _status
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_restaurant_payout_secure(
  _restaurant_id uuid, _payout_mode text, _moncash_number text, _moncash_account_name text,
  _natcash_number text, _natcash_account_name text
)
RETURNS public.restaurant_payout_details
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurant_payout_details;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _payout_mode NOT IN ('via_admin', 'direct') THEN
    RAISE EXCEPTION 'Invalid payout mode';
  END IF;
  IF _payout_mode = 'direct' AND _moncash_number IS NULL AND _natcash_number IS NULL THEN
    RAISE EXCEPTION 'Provide at least a MonCash or NatCash number for direct payouts';
  END IF;
  INSERT INTO public.restaurant_payout_details (
    restaurant_id, payout_mode, moncash_number, moncash_account_name, natcash_number, natcash_account_name
  ) VALUES (_restaurant_id, _payout_mode, _moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    payout_mode = excluded.payout_mode,
    moncash_number = excluded.moncash_number,
    moncash_account_name = excluded.moncash_account_name,
    natcash_number = excluded.natcash_number,
    natcash_account_name = excluded.natcash_account_name
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Revenue summary — every number computed server-side from orders/payments,
--    never trust a client-supplied total.
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
DECLARE v_rate numeric;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(d.commission_rate, 10) INTO v_rate
  FROM public.restaurant_payout_details d WHERE d.restaurant_id = _restaurant_id;
  v_rate := COALESCE(v_rate, 10);

  RETURN QUERY
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE o.status = 'delivered')::bigint,
    count(*) FILTER (WHERE o.status = 'cancelled')::bigint,
    COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0),
    v_rate,
    ROUND(COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) * v_rate / 100, 2),
    ROUND(COALESCE(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) * (100 - v_rate) / 100, 2),
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

-- ---------------------------------------------------------------------------
-- Grants: every function above is owner/admin-gated internally, so it's safe
-- to expose EXECUTE to all authenticated users.
REVOKE ALL ON FUNCTION public.create_menu_category_secure(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_menu_category_secure(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_menu_category_secure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product_secure(uuid, uuid, text, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_secure(uuid, text, text, numeric, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_product_secure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_promotion_secure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_restaurant_profile_secure(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_restaurant_hours_secure(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_restaurant_status_secure(uuid, public.restaurant_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_restaurant_payout_secure(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_restaurant_revenue_summary(uuid, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_menu_category_secure(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_menu_category_secure(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_menu_category_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_secure(uuid, uuid, text, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_secure(uuid, text, text, numeric, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_promotion_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_profile_secure(uuid, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_hours_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_status_secure(uuid, public.restaurant_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_payout_secure(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_restaurant_revenue_summary(uuid, date, date) TO authenticated;
