-- Business rule change: restaurants can no longer receive customer payments
-- directly. Every MonCash/NatCash payment now always routes to the platform
-- (admin) account; restaurants are paid their commission-adjusted earnings
-- out-of-band by the admin, exactly like drivers already work (drivers have
-- never had a "customer pays driver directly" option — see the `drivers`
-- table, which only stores payout numbers for the admin to pay them out).
-- This removes the `payout_mode` ('via_admin' | 'direct') concept entirely
-- rather than just defaulting it, matching that existing driver model 1:1.

-- 1) Data safety: normalize any restaurant currently configured for direct
--    payouts back to admin-routed before the column disappears.
UPDATE public.restaurant_payout_details SET payout_mode = 'via_admin' WHERE payout_mode = 'direct';

-- 2) Drop the column. moncash_number/natcash_number/*_account_name stay —
--    restaurants still set these so the admin knows where to pay them out,
--    same as drivers.moncash_number/natcash_number.
ALTER TABLE public.restaurant_payout_details DROP COLUMN IF EXISTS payout_mode;

-- 3) get_restaurant_payout_public: return type changes (column removed), so
--    the old function must be dropped before recreating.
DROP FUNCTION IF EXISTS public.get_restaurant_payout_public(uuid);

CREATE FUNCTION public.get_restaurant_payout_public(_restaurant_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id, moncash_number, moncash_account_name,
         natcash_number, natcash_account_name
  FROM public.restaurant_payout_details
  WHERE restaurant_id = _restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_payout_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid) TO authenticated;

-- 4) update_restaurant_payout_secure: argument list changes (payout_mode
--    param removed), so the old 6-arg overload must be dropped explicitly —
--    a same-name CREATE OR REPLACE with a different arg list creates a new
--    overload instead of replacing it (see check-migration-hazards.mjs).
DROP FUNCTION IF EXISTS public.update_restaurant_payout_secure(uuid, text, text, text, text, text);

CREATE FUNCTION public.update_restaurant_payout_secure(
  _restaurant_id uuid, _moncash_number text, _moncash_account_name text,
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
  INSERT INTO public.restaurant_payout_details (
    restaurant_id, moncash_number, moncash_account_name, natcash_number, natcash_account_name
  ) VALUES (_restaurant_id, _moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    moncash_number = excluded.moncash_number,
    moncash_account_name = excluded.moncash_account_name,
    natcash_number = excluded.natcash_number,
    natcash_account_name = excluded.natcash_account_name
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_restaurant_payout_secure(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_restaurant_payout_secure(uuid, text, text, text, text) TO authenticated;

-- 5) create_order_secure: same signature as before (CREATE OR REPLACE is
--    safe here, no new overload) — drop the payout_mode/direct branch
--    entirely and always resolve the receiver to the platform account. Also
--    fixes a pre-existing staleness bug in passing: the admin receiver
--    numbers were hardcoded literals here, disconnected from
--    platform_payout_settings (the table update_platform_payout_settings_secure
--    actually writes to) — now reads live from that table like checkout's
--    own get_platform_payout_public() already does.
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
  v_platform record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_line_total numeric(10,2);
  v_payment_status public.payment_status;
  v_receiver_number text;
  v_receiver_account text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('create_order', 8, 600) THEN
    RAISE EXCEPTION 'Twòp kòmand nan yon ti tan. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
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

  v_payment_status := CASE WHEN _method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
                           ELSE 'pending'::public.payment_status END;

  IF _method IN ('moncash', 'natcash') THEN
    SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
      INTO v_platform FROM public.platform_payout_settings WHERE id = true;
    IF _method = 'moncash' THEN
      v_receiver_number := v_platform.moncash_number;
      v_receiver_account := v_platform.moncash_account_name;
    ELSE
      v_receiver_number := v_platform.natcash_number;
      v_receiver_account := v_platform.natcash_account_name;
    END IF;
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name)
  VALUES (v_order_id, _method, v_payment_status, v_total, 'HTG',
    'admin', NULL, v_receiver_number, v_receiver_account);

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method) FROM PUBLIC, anon, authenticated;
