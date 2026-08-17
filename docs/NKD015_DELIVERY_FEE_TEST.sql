-- NKD-015 verification test — WRITTEN, per Règ A1 either run this
-- yourself in the SQL Editor or explicitly authorize it to be run.
-- BEGIN...ROLLBACK — nothing is kept, no real data touched.

BEGIN;

DO $$
DECLARE
  v_customer uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_zone_id uuid;
  v_order1 uuid;
  v_order2 uuid;
  v_fee1 numeric;
  v_fee2 numeric;
  v_caught boolean;
BEGIN
  -- Fixtures
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_customer, 'nkd015-customer@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'nkd015-owner@example.com', 'x', now(), '{}', '{}'),
    (v_admin, 'nkd015-admin@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'restaurant_owner'), (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'nkd015-test-resto', 'NKD015 Test Resto', 'approved', 0);
  INSERT INTO public.products (id, restaurant_id, name, price, dish_type, available)
  VALUES (v_product, v_restaurant, 'Diri Kole', 500, 'lot', true);

  SELECT id INTO v_zone_id FROM public.platform_delivery_zones WHERE is_default = true;
  IF v_zone_id IS NULL THEN RAISE EXCEPTION 'T0-FAIL: no default zone found -- seed row missing'; END IF;

  -- T-read: anon/authenticated can read the price (needed for checkout display)
  SET ROLE anon;
  SELECT fee_htg INTO v_fee1 FROM public.platform_delivery_zones WHERE is_default = true;
  RESET ROLE;
  IF v_fee1 IS NULL THEN RAISE EXCEPTION 'T-read-FAIL: anon cannot read the delivery fee'; END IF;
  RAISE NOTICE 'T-read-PASS: public can read the fee (%), needed for checkout display', v_fee1;

  -- T1: fee appears in orders.delivery_fee, total = subtotal + fee
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order1 := public.create_order_secure(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'Test Address', '+50912345678', null, 'kach', false
  );
  RESET ROLE;
  DECLARE
    v_row public.orders;
  BEGIN
    SELECT * INTO v_row FROM public.orders WHERE id = v_order1;
    IF v_row.delivery_fee <> v_fee1 THEN
      RAISE EXCEPTION 'T1-FAIL: orders.delivery_fee (%) does not match zone fee (%)', v_row.delivery_fee, v_fee1;
    END IF;
    IF v_row.total <> v_row.subtotal + v_row.delivery_fee + v_row.service_fee THEN
      RAISE EXCEPTION 'T1-FAIL: total does not equal subtotal+delivery_fee+service_fee';
    END IF;
  END;
  RAISE NOTICE 'T1-PASS: orders.delivery_fee = zone fee (%), total = subtotal + fee', v_fee1;

  -- T2: non-admin cannot change the fee
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.update_delivery_zone_fee_secure(v_zone_id, 999);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T2-FAIL: non-admin was able to change the delivery fee'; END IF;
  RAISE NOTICE 'T2-PASS: non-admin rejected';

  -- T3: admin without fresh step-up is rejected (STANDARD tier, no prior verification in this session)
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.update_delivery_zone_fee_secure(v_zone_id, 200);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T3-FAIL: admin fee change succeeded without step-up verification'; END IF;
  RAISE NOTICE 'T3-PASS: admin without fresh step-up rejected (STEP_UP_REQUIRED)';

  -- T4: existing order keeps its original fee after the platform fee changes.
  -- Simulate a verified step-up session the same way prior migrations'
  -- tests do (private.admin_step_up_status reads a real MFA/session check
  -- this synthetic user can't satisfy -- so this step directly proves the
  -- *data* behavior via a raw UPDATE instead of exercising the RPC's auth
  -- path a second time, which T2/T3 already cover).
  UPDATE public.platform_delivery_zones SET fee_htg = 200, updated_at = now() WHERE id = v_zone_id;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order2 := public.create_order_secure(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'Test Address', '+50912345678', null, 'kach', false
  );
  RESET ROLE;

  SELECT delivery_fee INTO v_fee1 FROM public.orders WHERE id = v_order1; -- old order
  SELECT delivery_fee INTO v_fee2 FROM public.orders WHERE id = v_order2; -- new order
  IF v_fee1 = v_fee2 THEN
    RAISE EXCEPTION 'T4-FAIL: old order fee (%) should differ from new order fee (%) after a price change', v_fee1, v_fee2;
  END IF;
  IF v_fee2 <> 200 THEN
    RAISE EXCEPTION 'T4-FAIL: new order should have picked up the new price 200, got %', v_fee2;
  END IF;
  RAISE NOTICE 'T4-PASS: old order kept fee %, new order picked up new fee %', v_fee1, v_fee2;

  RAISE NOTICE 'ALL NKD-015 TESTS PASSED (T-read, T1, T2, T3, T4)';
END $$;

ROLLBACK;
