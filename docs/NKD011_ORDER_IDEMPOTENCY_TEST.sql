-- NKD-011 verification test — WRITTEN, per Règ A1 run this yourself in the
-- SQL Editor (or explicitly authorize it) — never CLI, never auto-applied.
-- Format per Règ A10: results go into a temp table + SELECT before
-- ROLLBACK — SQL Editor has no Messages tab, RAISE NOTICE is invisible.
-- BEGIN...ROLLBACK — nothing this file does survives.

BEGIN;

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
  -- Fixtures
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

  -- T1/T2/T3: same key twice -> one order, one order_id, stock decremented
  -- once, one payments row.
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

  -- T4: different key -> a genuinely different order (normal behavior)
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order2 := public.create_order_secure(v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'Test Address', '+50912345678', null, 'kach', false, v_key2);
  RESET ROLE;

  INSERT INTO test_results VALUES ('T4', CASE WHEN v_order2 <> v_order1 THEN 'PASS' ELSE 'FAIL' END,
    format('order1=%s, order2 (kle diferan)=%s', v_order1, v_order2));

  -- T5: an order that fails on stock frees the key for a real retry. Use a
  -- fresh key + ask for more than is left (stock is now 10 - 2 - 1 = 7).
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
    -- The failed attempt must not have left a orders row behind (whole
    -- transaction-scoped call rolls back on RAISE EXCEPTION) -- retry with
    -- the SAME key and a fulfillable quantity must succeed normally.
    v_order3 := public.create_order_secure(v_restaurant,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'Test Address', '+50912345678', null, 'kach', false, v_key3);
    RESET ROLE;
    INSERT INTO test_results VALUES ('T5', CASE WHEN v_caught AND v_order3 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
      format('premye tantativ echwe=%s, dezyèm tantativ (menm kle) reyisi, order3=%s', v_caught, v_order3));
  END;

  -- T6: null key rejected unconditionally (owner decision).
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

  -- T7 (concurrency, honest limitation): a single serial SQL Editor script
  -- cannot open two real simultaneous DB connections, so "two requests at
  -- literally the same instant" cannot be *observed* here. What this DOES
  -- verify: ON CONFLICT (idempotency_key) DO UPDATE ... RETURNING is the
  -- statement actually in use (not a SELECT-then-INSERT check, which WOULD
  -- race) -- confirmed by reading the live function body below. The
  -- atomicity guarantee for real concurrent duplicate requests rests on
  -- Postgres's own documented row-level locking on the conflicting unique
  -- index entry (the standard, well-established behavior of this exact
  -- SQL idiom) -- not something this single-session script can exercise
  -- directly. Marked NOT-TESTED, not PASS, per Règ A9.
  INSERT INTO test_results VALUES ('T7', 'NOT-TESTED',
    CASE WHEN (
      SELECT pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (idempotency_key) DO UPDATE%'
      FROM pg_proc p WHERE p.proname = 'create_order_secure' AND pg_get_function_identity_arguments(p.oid) LIKE '%_idempotency_key%' AND p.pronamespace = 'private'::regnamespace
    ) THEN 'konfime: fonksyon an itilize ON CONFLICT ... DO UPDATE ... RETURNING (atomik) -- pa yon SELECT apre INSERT ki ta gen ras. Konkirans reyèl mande 2 koneksyon separe, pa ka fèt nan 1 script SQL Editor sekans.'
    ELSE 'AVÈTISMAN: pa jwenn ON CONFLICT DO UPDATE nan kò fonksyon an -- verifye migrasyon an aplike' END);

END $$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
