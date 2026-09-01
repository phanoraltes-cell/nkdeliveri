-- NKD-010 verification test — WRITTEN, NOT EXECUTED.
-- Per Règ A1: run this in the Supabase SQL Editor and paste the result
-- back. BEGIN...ROLLBACK — nothing is kept, no real data touched.
--
-- Covers: T1 simple decrement, T2 insufficient stock (whole order fails,
-- stock unchanged), T4 NULL bypass, T5 cancellation restock (once, not
-- double-counted even if attempted twice). T3 (real concurrency) and T6
-- (cross-path double-credit via complete_refund_secure) are noted at the
-- end as needing a different verification method than a single
-- transaction can express — see the accompanying report.

BEGIN;

-- Apply the migration inside this same transaction.
CREATE OR REPLACE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false
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
    subtotal, delivery_fee, service_fee, total, currency, status, wants_location_sharing
  ) VALUES (
    v_order_number, v_user, _restaurant_id, _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending', COALESCE(_wants_location_sharing, false)
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

CREATE OR REPLACE FUNCTION private.update_order_status_secure(_order_id uuid, _new_status public.order_status)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_old_status public.order_status;
  v_is_admin boolean;
  v_is_restaurant_owner boolean;
  v_is_assigned_driver boolean;
  v_is_customer boolean;
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
  v_old_status := v_order.status;

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
  v_is_customer := v_order.customer_id = v_user;

  IF NOT (v_is_admin OR v_is_restaurant_owner OR v_is_assigned_driver OR v_is_customer) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_admin THEN
    v_allowed := true;
  ELSIF v_is_customer THEN
    IF NOT public.check_rate_limit_secure('cancel_order_customer', 5, 3600) THEN
      RAISE EXCEPTION 'Twòp demann anilasyon. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
    END IF;
    v_allowed := _new_status = 'cancelled' AND v_order.status IN ('pending', 'confirmed');
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
    IF v_allowed AND v_order.status = 'pending' AND _new_status = 'confirmed' THEN
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND NOT EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman otomatik la poko konfime. N ap tann konfimasyon sistèm peman an anvan kòmand lan ka konfime — pa gen okenn aksyon admin ki nesesè.' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF v_is_assigned_driver THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('ready','assigned'), ('assigned','picked_up'), ('picked_up','delivered')
    );
  END IF;

  IF NOT v_allowed THEN
    IF v_is_customer THEN
      RAISE EXCEPTION 'Ou pa ka anile kòmand sa a ankò — restoran an deja kòmanse prepare l.';
    END IF;
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

  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  IF _new_status IN ('cancelled', 'delivered') THEN
    DELETE FROM public.customer_delivery_locations
    WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE order_id = v_order.id);
  END IF;

  IF v_is_customer AND _new_status = 'cancelled' THEN
    PERFORM private.log_audit_event(v_user, 'customer', 'order.cancelled_by_customer',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));
    PERFORM private.notify_secure(
      ARRAY(
        SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL
        UNION
        SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')
      ),
      'order_cancelled_by_customer', 'order', 'Kliyan anile yon kòmand',
      'Kliyan an anile kòmand ' || v_order.order_number || ' anvan preparasyon kòmanse.',
      jsonb_build_object('order_id', v_order.id)
    );
  ELSIF _new_status IN ('confirmed', 'preparing', 'ready', 'cancelled') THEN
    v_status_label := CASE _new_status
      WHEN 'confirmed' THEN 'konfime'
      WHEN 'preparing' THEN 'ap prepare'
      WHEN 'ready' THEN 'prè pou livrezon'
      WHEN 'cancelled' THEN 'anile'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a ' || v_status_label,
      'Kòmand ' || v_order.order_number || ' kounye a ' || v_status_label || '.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  END IF;

  RETURN v_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_refund_secure(_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
  v_order_status public.order_status;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved refund can be marked completed';
  END IF;

  UPDATE public.refunds SET
    status = 'completed',
    completed_at = now(),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'completed', 'by', v_user, 'at', now())
  WHERE id = _refund_id
  RETURNING * INTO v_row;

  UPDATE public.payments SET status = 'refunded' WHERE id = v_row.payment_id;

  SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id FOR UPDATE;
  UPDATE public.orders SET
    status = 'refunded',
    status_history = status_history || jsonb_build_object(
      'from', v_order_status, 'to', 'refunded', 'by', v_user, 'at', now()
    ),
    updated_at = now()
  WHERE id = v_row.order_id;

  IF v_order_status NOT IN ('cancelled', 'refunded') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_row.order_id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id, 'refund_completed', 'Ranbousman trete',
    'Lajan pou kòmand ou an ranbouse.',
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$$;

DO $$
DECLARE
  v_customer1 uuid := gen_random_uuid();
  v_customer2 uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_product_tracked uuid := gen_random_uuid();
  v_product_unlimited uuid := gen_random_uuid();
  v_order1 uuid;
  v_order2 uuid;
  v_stock int;
  v_caught boolean;
  v_msg text;
BEGIN
  -- Fixtures
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_customer1, 'nkd010-c1@example.com', 'x', now(), '{}', '{}'),
    (v_customer2, 'nkd010-c2@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'nkd010-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner, 'restaurant_owner');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status)
  VALUES (v_restaurant, v_owner, 'nkd010-test-resto', 'NKD010 Test Resto', 'approved');
  INSERT INTO public.products (id, restaurant_id, name, price, dish_type, available, stock_quantity)
  VALUES (v_product_tracked, v_restaurant, 'Diri Kole', 500, 'lot', true, 5);
  INSERT INTO public.products (id, restaurant_id, name, price, dish_type, available, stock_quantity)
  VALUES (v_product_unlimited, v_restaurant, 'Bouyon (sou kòmand)', 700, 'lot', true, NULL);

  -- T1: simple decrement — stock 5, order 2 -> 3
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer1, 'role', 'authenticated')::text, true);
  v_order1 := public.create_order_secure(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product_tracked, 'quantity', 2)),
    'Test Address', '+50912345678', null, 'kach', false
  );
  RESET ROLE;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_tracked;
  IF v_stock <> 3 THEN RAISE EXCEPTION 'T1-FAIL: expected stock 3, got %', v_stock; END IF;
  RAISE NOTICE 'T1-PASS: stock 5 -> 3 after ordering 2';

  -- T2: insufficient stock — stock 3, order 10 -> whole order fails, stock unchanged
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer1, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_order_secure(
      v_restaurant,
      jsonb_build_array(jsonb_build_object('product_id', v_product_tracked, 'quantity', 10)),
      'Test Address', '+50912345678', null, 'kach', false
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    v_msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T2-FAIL: order with insufficient stock succeeded'; END IF;
  IF v_msg NOT LIKE '%Pa gen ase estòk%' THEN RAISE EXCEPTION 'T2-FAIL: unexpected message: %', v_msg; END IF;
  IF v_msg LIKE '%stock_quantity%' OR v_msg ~ '[0-9]' THEN
    RAISE EXCEPTION 'T2-FAIL: message leaks column name or exact count: %', v_msg;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_tracked;
  IF v_stock <> 3 THEN RAISE EXCEPTION 'T2-FAIL: stock changed despite failed order, now %', v_stock; END IF;
  RAISE NOTICE 'T2-PASS: insufficient stock rejected in Kreyòl, no leak, stock unchanged at 3';

  -- T4: NULL product bypasses entirely — order 100 units of the unlimited dish
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer1, 'role', 'authenticated')::text, true);
  PERFORM public.create_order_secure(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product_unlimited, 'quantity', 100)),
    'Test Address', '+50912345678', null, 'kach', false
  );
  RESET ROLE;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_unlimited;
  IF v_stock IS NOT NULL THEN RAISE EXCEPTION 'T4-FAIL: NULL-stock product was decremented, now %', v_stock; END IF;
  RAISE NOTICE 'T4-PASS: NULL stock product never blocked, never decremented';

  -- T5: cancellation restock — order 3 more (stock 3->0), cancel it, expect back to 3
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer2, 'role', 'authenticated')::text, true);
  v_order2 := public.create_order_secure(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('product_id', v_product_tracked, 'quantity', 3)),
    'Test Address 2', '+50987654321', null, 'kach', false
  );
  RESET ROLE;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_tracked;
  IF v_stock <> 0 THEN RAISE EXCEPTION 'T5-FAIL: expected stock 0 before cancel, got %', v_stock; END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer2, 'role', 'authenticated')::text, true);
  PERFORM public.update_order_status_secure(v_order2, 'cancelled');
  RESET ROLE;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_tracked;
  IF v_stock <> 3 THEN RAISE EXCEPTION 'T5-FAIL: expected stock 3 after cancel, got %', v_stock; END IF;
  RAISE NOTICE 'T5-PASS: cancelling the order returned its 3 units, stock back to 3';

  -- T5b (idempotence): cancelling an already-cancelled order must not
  -- double-credit. The transition table itself should already reject
  -- this (customer: only from 'pending'/'confirmed'), proving the guard
  -- via the RAISE, not a silent no-op.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer2, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.update_order_status_secure(v_order2, 'cancelled');
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  RESET ROLE;
  IF NOT v_caught THEN RAISE EXCEPTION 'T5b-FAIL: re-cancelling an already-cancelled order was allowed'; END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_tracked;
  IF v_stock <> 3 THEN RAISE EXCEPTION 'T5b-FAIL: stock double-credited to %, expected still 3', v_stock; END IF;
  RAISE NOTICE 'T5b-PASS: re-cancel rejected by the transition table, stock still 3 (no double-credit)';

  RAISE NOTICE 'ALL NKD-010 TESTS PASSED (T1, T2, T4, T5, T5b)';
  RAISE NOTICE 'T3 (real concurrency) and T6 (cross-path double-credit via complete_refund_secure) require either pgbench/two real sessions or a longer fixture chain than this single-transaction test can express -- see the accompanying report for why, and for the manual verification recommended after deployment.';
END $$;

ROLLBACK;
