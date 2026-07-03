
-- ============================================================
-- 1) Trigger: block self-set of commission on restaurant_payout_details
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_restaurant_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  -- Non-admins cannot change commission-related fields; revert to OLD values.
  NEW.commission_type := OLD.commission_type;
  NEW.commission_rate := OLD.commission_rate;
  NEW.monthly_commission_amount := OLD.monthly_commission_amount;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_restaurant_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_restaurant_commission ON public.restaurant_payout_details;
CREATE TRIGGER trg_protect_restaurant_commission
BEFORE UPDATE ON public.restaurant_payout_details
FOR EACH ROW EXECUTE FUNCTION public.protect_restaurant_commission();

-- Also enforce on INSERT: force defaults for non-admins.
CREATE OR REPLACE FUNCTION public.protect_restaurant_commission_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  NEW.commission_type := NULL;
  NEW.commission_rate := NULL;
  NEW.monthly_commission_amount := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_restaurant_commission_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_restaurant_commission_ins ON public.restaurant_payout_details;
CREATE TRIGGER trg_protect_restaurant_commission_ins
BEFORE INSERT ON public.restaurant_payout_details
FOR EACH ROW EXECUTE FUNCTION public.protect_restaurant_commission_insert();

-- ============================================================
-- 2) Trigger: block self-set of commission_rate on drivers
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_driver_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  NEW.commission_rate := OLD.commission_rate;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_driver_commission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_driver_commission ON public.drivers;
CREATE TRIGGER trg_protect_driver_commission
BEFORE UPDATE ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.protect_driver_commission();

-- ============================================================
-- 3) Server-side order creation with authoritative pricing
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,               -- [{ "product_id": "...", "quantity": 2, "notes": "..." }, ...]
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_service_fee numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_restaurant record;
  v_payout record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_line_total numeric(10,2);
  v_payment_status public.payment_status;
  v_receiver_type text;
  v_receiver_number text;
  v_receiver_account text;
  v_receiver_restaurant uuid;
  v_admin_moncash text;
  v_admin_natcash text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  IF _delivery_address IS NULL OR length(btrim(_delivery_address)) = 0 THEN
    RAISE EXCEPTION 'Delivery address is required';
  END IF;
  IF _contact_phone IS NULL OR length(btrim(_contact_phone)) = 0 THEN
    RAISE EXCEPTION 'Contact phone is required';
  END IF;

  SELECT id, name, delivery_fee, status
    INTO v_restaurant
    FROM public.restaurants
    WHERE id = _restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
  IF v_restaurant.status <> 'approved' THEN
    RAISE EXCEPTION 'Restaurant is not available';
  END IF;

  v_delivery_fee := COALESCE(v_restaurant.delivery_fee, 150);

  -- Create the order shell first so we can attach items to it.
  v_order_number := 'NK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.orders (
    order_number, customer_id, restaurant_id,
    delivery_address, delivery_notes, contact_phone,
    subtotal, delivery_fee, service_fee, total, currency, status
  ) VALUES (
    v_order_number, v_user, _restaurant_id,
    _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending'
  )
  RETURNING id INTO v_order_id;

  -- Validate and insert each item using authoritative price from products.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    SELECT id, name, price, restaurant_id, available
      INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_item->>'product_id';
    END IF;
    IF v_product.restaurant_id <> _restaurant_id THEN
      RAISE EXCEPTION 'Product does not belong to this restaurant';
    END IF;
    IF NOT v_product.available THEN
      RAISE EXCEPTION 'Product % is not available', v_product.name;
    END IF;

    v_line_total := v_product.price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total, notes
    ) VALUES (
      v_order_id, v_product.id, v_product.name, v_product.price, v_qty, v_line_total,
      NULLIF(btrim(v_item->>'notes'), '')
    );
  END LOOP;

  v_total := v_subtotal + v_delivery_fee + v_service_fee;

  UPDATE public.orders
     SET subtotal = v_subtotal,
         service_fee = v_service_fee,
         total = v_total
   WHERE id = v_order_id;

  -- Determine receiver details for the payment row (server-side).
  SELECT payout_mode, moncash_number, moncash_account_name, natcash_number, natcash_account_name
    INTO v_payout
    FROM public.restaurant_payout_details
    WHERE restaurant_id = _restaurant_id;

  v_admin_moncash := '+(509) 47419458';
  v_admin_natcash := '+(509) 41678490';

  v_payment_status := CASE
    WHEN _method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
    ELSE 'pending'::public.payment_status
  END;

  IF _method IN ('moncash', 'natcash') AND v_payout.payout_mode = 'direct' THEN
    v_receiver_type := 'merchant';
    v_receiver_restaurant := _restaurant_id;
    IF _method = 'moncash' THEN
      v_receiver_number := v_payout.moncash_number;
      v_receiver_account := v_payout.moncash_account_name;
    ELSE
      v_receiver_number := v_payout.natcash_number;
      v_receiver_account := v_payout.natcash_account_name;
    END IF;
    IF v_receiver_number IS NULL THEN
      RAISE EXCEPTION 'Restaurant has not configured this payment method';
    END IF;
  ELSE
    v_receiver_type := 'admin';
    v_receiver_restaurant := NULL;
    IF _method = 'moncash' THEN
      v_receiver_number := v_admin_moncash;
      v_receiver_account := 'Jasline Phanor';
    ELSIF _method = 'natcash' THEN
      v_receiver_number := v_admin_natcash;
      v_receiver_account := 'Jasline Phanor';
    END IF;
  END IF;

  INSERT INTO public.payments (
    order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name
  ) VALUES (
    v_order_id, _method, v_payment_status, v_total, 'HTG',
    v_receiver_type, v_receiver_restaurant, v_receiver_number, v_receiver_account
  );

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) TO authenticated;
