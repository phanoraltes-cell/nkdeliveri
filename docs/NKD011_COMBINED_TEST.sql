-- NKD-011 combined migration + test — WRITTEN, per Règ A1 run this yourself
-- in the SQL Editor (or explicitly authorize it) — never CLI. BEGIN...
-- ROLLBACK — nothing here survives, including the migration itself. This
-- is a rehearsal to see the test_results table before deciding to apply
-- for real. Format per Règ A10: results in a temp table + SELECT before
-- ROLLBACK, not RAISE NOTICE (invisible in SQL Editor).

BEGIN;

-- =====================  MIGRATION (rehearsal)  =====================

ALTER TABLE public.orders ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX orders_idempotency_key_uniq ON public.orders (idempotency_key);

DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean);
CREATE FUNCTION private.create_order_secure(
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
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restaurant is not available'; END IF;

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
      RAISE EXCEPTION 'Product % is not available', v_product.name;
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

DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean);
CREATE FUNCTION public.create_order_secure(
  _restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text,
  _delivery_notes text, _method public.payment_method, _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method,
    _wants_location_sharing, _idempotency_key
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid) TO authenticated;

-- =====================  TEST (Règ A10 format)  =====================

CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_customer uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_key1 uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_order1 uuid;
  v_order1_retry uuid;
  v_order2 uuid;
  v_stock_after_first int;
  v_stock_after_retry int;
  v_payment_count int;
  v_order_count_key1 int;
  v_caught boolean;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_customer, 'nkd011-customer@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'nkd011-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'restaurant_owner');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'nkd011-test-resto', 'NKD011 Test Resto', 'approved', 0);
  INSERT INTO public.products (id, restaurant_id, name, price, dish_type, available, stock_quantity)
  VALUES (v_product, v_restaurant, 'Diri Kole', 500, 'lot', true, 10);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);

  v_order1 := public.create_order_secure(v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'Test Address', '+50912345678', null, 'kach', false, v_key1);
  SELECT stock_quantity INTO v_stock_after_first FROM public.products WHERE id = v_product;

  v_order1_retry := public.create_order_secure(v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'Test Address', '+50912345678', null, 'kach', false, v_key1);
  SELECT stock_quantity INTO v_stock_after_retry FROM public.products WHERE id = v_product;

  RESET ROLE;

  SELECT count(*) INTO v_order_count_key1 FROM public.orders WHERE idempotency_key = v_key1;
  SELECT count(*) INTO v_payment_count FROM public.payments WHERE order_id = v_order1;

  INSERT INTO test_results VALUES ('T1', CASE WHEN v_order1 = v_order1_retry THEN 'PASS' ELSE 'FAIL' END,
    format('order1=%s, retry=%s (menm order_id atandi)', v_order1, v_order1_retry));
  INSERT INTO test_results VALUES ('T1b', CASE WHEN v_order_count_key1 = 1 THEN 'PASS' ELSE 'FAIL' END,
    format('%s ranje orders pou idempotency_key=%s (atann 1)', v_order_count_key1, v_key1));
  INSERT INTO test_results VALUES ('T2', CASE WHEN v_stock_after_retry = v_stock_after_first THEN 'PASS' ELSE 'FAIL' END,
    format('estòk apre 1ye apèl=%s, apre retry=%s (dwe idantik)', v_stock_after_first, v_stock_after_retry));
  INSERT INTO test_results VALUES ('T3', CASE WHEN v_payment_count = 1 THEN 'PASS' ELSE 'FAIL' END,
    format('%s ranje payments pou order1 (atann 1)', v_payment_count));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order2 := public.create_order_secure(v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'Test Address', '+50912345678', null, 'kach', false, v_key2);
  RESET ROLE;

  INSERT INTO test_results VALUES ('T4', CASE WHEN v_order2 <> v_order1 THEN 'PASS' ELSE 'FAIL' END,
    format('order1=%s, order2 (kle diferan)=%s', v_order1, v_order2));

  DECLARE
    v_key3 uuid := gen_random_uuid();
    v_order3 uuid;
  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
    v_caught := false;
    BEGIN
      PERFORM public.create_order_secure(v_restaurant,
        jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 999)),
        'Test Address', '+50912345678', null, 'kach', false, v_key3);
    EXCEPTION WHEN OTHERS THEN v_caught := true;
    END;
    v_order3 := public.create_order_secure(v_restaurant,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'Test Address', '+50912345678', null, 'kach', false, v_key3);
    RESET ROLE;
    INSERT INTO test_results VALUES ('T5', CASE WHEN v_caught AND v_order3 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
      format('premye tantativ echwe=%s, dezyèm tantativ (menm kle) reyisi, order3=%s', v_caught, v_order3));
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_order_secure(v_restaurant,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'Test Address', '+50912345678', null, 'kach', false, NULL);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T6', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'kle NULL dwe rejte san kondisyon');

  INSERT INTO test_results VALUES ('T7', 'NOT-TESTED',
    'Konkirans reyèl mande 2 koneksyon similtane, pa ka fèt nan 1 script SQL Editor sekansyèl. Atomisite a rete sou ON CONFLICT ... DO UPDATE ... RETURNING (verifye pi wo nan menm fichye sa a), pa yon SELECT apre INSERT ki ta gen ras.');

END $$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
