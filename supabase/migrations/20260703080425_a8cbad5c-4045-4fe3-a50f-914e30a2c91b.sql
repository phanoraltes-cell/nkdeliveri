
-- Move create_order_secure into private schema
CREATE OR REPLACE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
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

  SELECT id, name, delivery_fee, status INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restaurant is not available'; END IF;

  v_delivery_fee := COALESCE(v_restaurant.delivery_fee, 150);
  v_order_number := 'NK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.orders (
    order_number, customer_id, restaurant_id, delivery_address, delivery_notes, contact_phone,
    subtotal, delivery_fee, service_fee, total, currency, status
  ) VALUES (
    v_order_number, v_user, _restaurant_id, _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending'
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    SELECT id, name, price, restaurant_id, available INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.restaurant_id <> _restaurant_id THEN
      RAISE EXCEPTION 'Product does not belong to this restaurant';
    END IF;
    IF NOT v_product.available THEN
      RAISE EXCEPTION 'Product % is not available', v_product.name;
    END IF;

    v_line_total := v_product.price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total, notes)
    VALUES (v_order_id, v_product.id, v_product.name, v_product.price, v_qty, v_line_total,
            NULLIF(btrim(v_item->>'notes'), ''));
  END LOOP;

  v_total := v_subtotal + v_delivery_fee + v_service_fee;
  UPDATE public.orders SET subtotal = v_subtotal, service_fee = v_service_fee, total = v_total
    WHERE id = v_order_id;

  SELECT payout_mode, moncash_number, moncash_account_name, natcash_number, natcash_account_name
    INTO v_payout FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;

  v_payment_status := CASE WHEN _method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
                           ELSE 'pending'::public.payment_status END;

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
      v_receiver_number := '+(509) 47419458'; v_receiver_account := 'Jasline Phanor';
    ELSIF _method = 'natcash' THEN
      v_receiver_number := '+(509) 41678490'; v_receiver_account := 'Jasline Phanor';
    END IF;
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name)
  VALUES (v_order_id, _method, v_payment_status, v_total, 'HTG',
    v_receiver_type, v_receiver_restaurant, v_receiver_number, v_receiver_account);

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) FROM PUBLIC, anon, authenticated;

-- Drop the public DEFINER version and replace with a thin INVOKER wrapper
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method);

CREATE OR REPLACE FUNCTION public.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.create_order_secure(_restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method);
$$;

REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) TO authenticated;
