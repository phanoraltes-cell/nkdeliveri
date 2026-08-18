-- NKD-016 verification test — WRITTEN, per Règ A1 run this yourself in the
-- SQL Editor (or explicitly authorize it) — never CLI, never auto-applied.
-- Requires 20260817110000_nkd016_delivery_failed_enum_values.sql AND
-- 20260817120000_nkd016_delivery_failed.sql already applied for real first
-- (unlike NKD-015, this cannot be a single combined BEGIN...ROLLBACK: the
-- new enum values cannot be used in the same transaction that adds them —
-- a real Postgres restriction, not a workaround of convenience). This file
-- only exercises functionality; nothing it does survives (BEGIN...ROLLBACK).
--
-- Note on raw UPDATEs below: any raw UPDATE on public.deliveries must run
-- inside a SET ROLE authenticated block with a JWT claim set, because
-- private.protect_delivery_status_transition() re-checks auth.uid()
-- unconditionally in its own body — RLS bypass (the default, unauthenticated
-- session this whole DO block otherwise runs as) does NOT bypass that
-- check, since it isn't RLS, it's a trigger. Raw UPDATEs on public.orders
-- have no such trigger and are used unwrapped, purely as test fixtures,
-- exactly like prior migrations' tests.

BEGIN;

DO $$
DECLARE
  v_customer uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_driver_user uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_driver uuid;
  v_order uuid;
  v_delivery_id uuid;
  v_caught boolean;
  v_wallet_after numeric;
  v_ledger_count int;
  v_stock_before int;
  v_stock_after int;
  v_status public.order_status;
BEGIN
  -- Fixtures
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_customer, 'nkd016-customer@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'nkd016-owner@example.com', 'x', now(), '{}', '{}'),
    (v_admin, 'nkd016-admin@example.com', 'x', now(), '{}', '{}'),
    (v_driver_user, 'nkd016-driver@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'restaurant_owner'), (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'nkd016-test-resto', 'NKD016 Test Resto', 'approved', 0);
  INSERT INTO public.products (id, restaurant_id, name, price, dish_type, available, stock_quantity)
  VALUES (v_product, v_restaurant, 'Diri Kole', 500, 'lot', true, 10);
  INSERT INTO public.drivers (user_id, status, commission_rate)
  VALUES (v_driver_user, 'online', 100) RETURNING id INTO v_driver;

  -- T0: mandatory phone -- create_order_secure rejects a null/empty phone
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_order_secure(v_restaurant, jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'Test Address', '', null, 'kach', false);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T0-FAIL: order created with an empty contact phone'; END IF;
  RAISE NOTICE 'T0-PASS: order without contact_phone rejected';

  -- Real order, claimed and moved to picked_up, for the rest of the tests.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order := public.create_order_secure(v_restaurant, jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'Test Address', '+50912345678', null, 'kach', false);
  RESET ROLE;

  SELECT stock_quantity INTO v_stock_before FROM public.products WHERE id = v_product;

  UPDATE public.orders SET status = 'ready' WHERE id = v_order; -- admin shortcut, not under test

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  PERFORM public.claim_delivery_secure(v_order);
  SELECT id INTO v_delivery_id FROM public.deliveries WHERE order_id = v_order;
  UPDATE public.deliveries SET status = 'picked_up' WHERE id = v_delivery_id; -- ('assigned','picked_up') is driver-legal
  RESET ROLE;

  -- T1: picked_up -> delivery_failed works (driver, dedicated RPC)
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  PERFORM public.report_delivery_failed_secure(v_order, 'customer_unavailable', null);
  RESET ROLE;

  SELECT status INTO v_status FROM public.orders WHERE id = v_order;
  IF v_status <> 'delivery_failed' THEN
    RAISE EXCEPTION 'T1-FAIL: orders.status is % after report_delivery_failed_secure, expected delivery_failed', v_status;
  END IF;
  RAISE NOTICE 'T1-PASS: picked_up -> delivery_failed works, orders.status synced';

  -- T1b: 'other' reason requires a comment. Reset via admin (bypasses the
  -- transition whitelist entirely) back to picked_up first.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'picked_up', failure_reason = NULL, failure_comment = NULL WHERE id = v_delivery_id;
  RESET ROLE;
  UPDATE public.orders SET status = 'picked_up' WHERE id = v_order;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.report_delivery_failed_secure(v_order, 'other', null);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T1b-FAIL: reason=other accepted without a comment'; END IF;
  RAISE NOTICE 'T1b-PASS: reason=other without a comment rejected';

  -- Re-fail it for real (driver commission tests need it in delivery_failed again).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  PERFORM public.report_delivery_failed_secure(v_order, 'address_not_found', null);
  RESET ROLE;

  -- T2: driver commission credited (150 HTG * 100% = 150), restaurant NOT credited
  SELECT available_balance INTO v_wallet_after FROM public.wallets WHERE driver_id = v_driver;
  IF v_wallet_after IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'T2-FAIL: driver wallet balance is %, expected 150', v_wallet_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets WHERE restaurant_id = v_restaurant) THEN
    RAISE EXCEPTION 'T2-FAIL: restaurant was credited on a failed delivery -- must not be';
  END IF;
  SELECT count(*) INTO v_ledger_count FROM public.commission_ledger
    WHERE order_id = v_order AND entry_type = 'driver_commission_delivery_failed';
  IF v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'T2-FAIL: expected exactly 1 commission_ledger row, found %', v_ledger_count;
  END IF;
  RAISE NOTICE 'T2-PASS: driver credited 150 HTG, restaurant not credited, 1 ledger row';

  -- T3: idempotence -- force a second genuine AFTER UPDATE fire on orders
  -- (flip away, flip back: OLD.status IS DISTINCT FROM 'delivery_failed'
  -- is satisfied again, so the trigger genuinely re-runs, not a simulation).
  UPDATE public.orders SET status = 'picked_up' WHERE id = v_order;
  UPDATE public.orders SET status = 'delivery_failed' WHERE id = v_order;
  SELECT count(*) INTO v_ledger_count FROM public.commission_ledger
    WHERE order_id = v_order AND entry_type = 'driver_commission_delivery_failed';
  SELECT available_balance INTO v_wallet_after FROM public.wallets WHERE driver_id = v_driver;
  IF v_ledger_count <> 1 OR v_wallet_after IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'T3-FAIL: duplicate commission fire changed state (ledger rows=%, balance=%)', v_ledger_count, v_wallet_after;
  END IF;
  RAISE NOTICE 'T3-PASS: idempotent -- duplicate fire did not double-credit';

  -- T4: delivery_failed -> delivered works (admin, customer picked up at the
  -- office) AND does not double-credit the driver (Defect 1 fix: this is
  -- exactly the path trg_generate_commission_on_delivery fires on).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.update_order_status_secure(v_order, 'delivered');
  RESET ROLE;
  SELECT status INTO v_status FROM public.orders WHERE id = v_order;
  IF v_status <> 'delivered' THEN
    RAISE EXCEPTION 'T4-FAIL: delivery_failed -> delivered rejected';
  END IF;
  SELECT available_balance INTO v_wallet_after FROM public.wallets WHERE driver_id = v_driver;
  IF v_wallet_after IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'T4-FAIL: double commission -- driver balance is %, expected 150', v_wallet_after;
  END IF;
  SELECT count(*) INTO v_ledger_count FROM public.commission_ledger
    WHERE order_id = v_order AND driver_id = v_driver;
  IF v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'T4-FAIL: % commission_ledger rows for the driver, expected 1', v_ledger_count;
  END IF;
  RAISE NOTICE 'T4-PASS: delivery_failed -> delivered, no double commission';

  -- T5: delivery_failed -> cancelled: no refund, stock NOT returned
  UPDATE public.orders SET status = 'delivery_failed' WHERE id = v_order; -- reset for this test
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.update_order_status_secure(v_order, 'cancelled');
  RESET ROLE;
  SELECT stock_quantity INTO v_stock_after FROM public.products WHERE id = v_product;
  IF v_stock_after <> v_stock_before - 2 THEN
    RAISE EXCEPTION 'T5-FAIL: stock changed on delivery_failed -> cancelled (before=%, after=%) -- must stay at post-order level, food was already made', v_stock_before, v_stock_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE order_id = v_order AND status = 'refunded') THEN
    RAISE EXCEPTION 'T5-FAIL: payment was refunded on delivery_failed -> cancelled -- must not be (no-refund rule)';
  END IF;
  RAISE NOTICE 'T5-PASS: delivery_failed -> cancelled: stock not returned, no refund';

  -- T6: invalid transition rejected (delivery_failed -> picked_up)
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'delivery_failed' WHERE id = v_delivery_id; -- admin bypass, test fixture
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    UPDATE public.deliveries SET status = 'picked_up' WHERE id = v_delivery_id;
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T6-FAIL: delivery_failed -> picked_up was accepted, must be rejected'; END IF;
  RAISE NOTICE 'T6-PASS: delivery_failed -> picked_up rejected';

  -- T7: cash orders -- no money ever collected either way, nothing to
  -- assert beyond T5 (payment.status was never 'paid' for 'kach' orders in
  -- this whole test, and stays whatever it already was through the cancel
  -- path above -- same order used throughout this test IS a 'kach' order).

  -- T8 (Defect 2): en_route_dropoff -> delivery_failed must work -- a
  -- failed delivery is most often discovered on arrival, not right after
  -- pickup. Reset via admin, then the driver moves picked_up -> en_route_dropoff
  -- (already-legal driver transition) before reporting the failure.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'picked_up', failure_reason = NULL, failure_comment = NULL WHERE id = v_delivery_id;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'en_route_dropoff' WHERE id = v_delivery_id;
  v_caught := false;
  BEGIN
    PERFORM public.report_delivery_failed_secure(v_order, 'zone_inaccessible', null);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF v_caught THEN RAISE EXCEPTION 'T8-FAIL: en_route_dropoff -> delivery_failed was rejected, must be allowed'; END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = v_order;
  IF v_status <> 'delivery_failed' THEN
    RAISE EXCEPTION 'T8-FAIL: orders.status is %, expected delivery_failed', v_status;
  END IF;
  RAISE NOTICE 'T8-PASS: en_route_dropoff -> delivery_failed works';

  -- T9 (Defect 2 guard): assigned -> delivery_failed must be REJECTED --
  -- the driver hasn't picked up the food yet, there is nothing to fail.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'assigned', failure_reason = NULL, failure_comment = NULL WHERE id = v_delivery_id;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.report_delivery_failed_secure(v_order, 'customer_unavailable', null);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T9-FAIL: assigned -> delivery_failed was accepted, must be rejected'; END IF;
  RAISE NOTICE 'T9-PASS: assigned -> delivery_failed rejected';

  RAISE NOTICE 'ALL NKD-016 TESTS PASSED (T0, T1, T1b, T2, T3, T4, T5, T6, T8, T9)';
END $$;

ROLLBACK;
