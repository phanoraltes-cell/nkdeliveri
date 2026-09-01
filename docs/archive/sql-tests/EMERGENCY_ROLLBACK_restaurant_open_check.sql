-- URGENCE SÈLMAN — pa yon migrasyon nòmal, pa gen nimewo vèsyon/antre nan
-- supabase_migrations.schema_migrations. Itilize SÈLMAN si, apre
-- 20260821100000_restaurant_open_check_order_creation.sql aplike, kòmand
-- lejitim yo kòmanse rejte pou move rezon (orè mal antre, konfizyon
-- minwi/fuso lè, elatriye) — sentòm: kliyan rapòte "Restoran an fèmen
-- kounye a" pandan restoran an reyèlman louvri.
--
-- Sa a retire SÈLMAN chèk `is_restaurant_open()` a nan create_order_secure
-- — retounen kòmand kreyasyon an nan konpòtman li te genyen anvan (chèk
-- status='approved' sèlman, san chèk orè). Li KITE tout lòt bagay migrasyon
-- an te ajoute yo (kolòn opening_hours_grace_until, trigger la, fonksyon
-- is_restaurant_open() ak get_restaurants_missing_hours_admin() yo) an
-- plas — yo san danje pou yo rete si anyen pa rele is_restaurant_open()
-- pou bloke yon kòmand. Sa fè skript sa a rapid ak san risk anplis.
--
-- Apre ou kouri sa a: envestige done opening_hours restoran ki te afekte
-- yo (SELECT id, name, opening_hours FROM restaurants WHERE ...), korije
-- yo, epi re-aplike chèk la (yon nouvo CREATE OR REPLACE ki mete
-- `IF NOT public.is_restaurant_open(...)` tounen) sèlman lè done yo bon.
--
-- Wrapped BEGIN...COMMIT — yon sèl statman DDL, men konsistan ak rès
-- pwojè a.
BEGIN;

CREATE OR REPLACE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_was_inserted boolean;
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
  v_cash_status public.cash_confirmation_status;
  v_receiver_number text;
  v_receiver_account text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('create_order', 8, 600) THEN
    RAISE EXCEPTION 'Twòp kòmand nan yon ti tan. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;
  IF _delivery_address IS NULL OR length(btrim(_delivery_address)) = 0 THEN
    RAISE EXCEPTION 'Adrès livrezon nesesè pou n ka livre kòmand ou a.';
  END IF;
  IF _contact_phone IS NULL OR length(btrim(_contact_phone)) = 0 THEN
    RAISE EXCEPTION 'Nimewo telefòn ou nesesè pou n ka livre kòmand ou a.';
  END IF;

  SELECT id, name, status INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restoran an pa disponib kounye a.'; END IF;
  -- Chèk is_restaurant_open() RETIRE isit la (rollback ijans).

  SELECT fee_htg INTO v_delivery_fee
    FROM public.platform_delivery_zones WHERE is_default = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Konfigirasyon pri livrezon an pa jwenn — kontakte sipò.';
  END IF;

  v_order_number := 'NK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.orders (
    order_number, customer_id, restaurant_id, delivery_address, delivery_notes, contact_phone,
    subtotal, delivery_fee, service_fee, total, currency, status, wants_location_sharing, idempotency_key
  ) VALUES (
    v_order_number, v_user, _restaurant_id, _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending', COALESCE(_wants_location_sharing, false), _idempotency_key
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = orders.updated_at
  RETURNING id, (xmax = 0) INTO v_order_id, v_was_inserted;

  IF NOT v_was_inserted THEN
    RETURN v_order_id;
  END IF;

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
      RAISE EXCEPTION 'Plat "%" pa disponib ankò. Tanpri retire l nan panye a.', v_product.name;
    END IF;

    UPDATE public.products
    SET stock_quantity = stock_quantity - v_qty
    WHERE id = v_product.id
      AND (stock_quantity IS NULL OR stock_quantity >= v_qty);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pa gen ase estòk pou "%" kounye a.', v_product.name;
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
  v_cash_status := CASE WHEN _method = 'kach' THEN 'pending'::public.cash_confirmation_status ELSE NULL END;

  IF _method IN ('moncash', 'natcash') THEN
    SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
      INTO v_platform FROM public.platform_payout_settings WHERE id = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform payout settings not configured';
    END IF;
    IF _method = 'moncash' THEN
      v_receiver_number := v_platform.moncash_number;
      v_receiver_account := v_platform.moncash_account_name;
    ELSE
      v_receiver_number := v_platform.natcash_number;
      v_receiver_account := v_platform.natcash_account_name;
    END IF;
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name, cash_confirmation_status)
  VALUES (v_order_id, _method, v_payment_status, v_total, 'HTG',
    'admin', NULL, v_receiver_number, v_receiver_account, v_cash_status);

  RETURN v_order_id;
END;
$$;

COMMIT;
