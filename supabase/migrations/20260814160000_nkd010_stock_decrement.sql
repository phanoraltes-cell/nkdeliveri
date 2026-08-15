-- NKD-010: product stock decrement + restock on cancel/refund.
-- Business feature, authorized explicitly by the project owner
-- (docs/NKD-010_STOCK_LOGIC_REPORT.md has the full before/after, D1-D4
-- decisions, and test results).
--
-- ETAP 0 (mandatory, done before writing this): live data checked via
-- SQL Editor 2026-08-14 -- SELECT count(*) FILTER(...) FROM
-- public.products -> total=2, nil=0, zewo=0, pozitif=2. No product today
-- has stock_quantity=0 while actually available, no backfill needed, the
-- "whole menu disappears" risk this feature could otherwise trigger does
-- not apply to current data.
--
-- Confirmed decisions (D1-D4, docs/NKD-010_STOCK_LOGIC_REPORT.md):
--   D1: every product should eventually carry a real number; a NULL
--       product is untracked/unlimited (bypasses every check below) until
--       a restaurant sets one -- no arbitrary default assigned to today's
--       rows (there are none to assign one to anyway, per Etap 0).
--   D2: cancelling/refunding an order returns its items' stock.
--   D3: decrement happens inside create_order_secure -- the only atomic
--       moment, same transaction as order creation itself.
--   D4: the existing product-form.tsx stock_quantity field is sufficient;
--       no new restaurant UI needed.
--
-- Three functions touched, each CREATE OR REPLACE with the full body
-- reproduced (Postgres requires it) -- every line outside the marked
-- NKD-010 blocks is byte-identical to the live function, confirmed
-- against the source migrations that last defined each
-- (20260723090000_notifications_engine_and_gps_sharing.sql for
-- create_order_secure, 20260813120000_fix_manual_vs_automatic_payment_
-- classification.sql for update_order_status_secure,
-- 20260714130000_refunds.sql for complete_refund_secure), not retyped
-- from memory.
--
-- 2a/2b (atomic decrement, existing CHECK): the decrement is a single
-- conditional UPDATE, never a SELECT-then-UPDATE (the race the prompt
-- explicitly warns against -- two customers reading the same
-- pre-decrement count before either writes). stock_quantity IS NULL
-- bypasses the check entirely (D1). The non-negative floor
-- (`products_stock_quantity_non_negative`, added in
-- 20260706151929_add_product_stock_quantity.sql) already exists -- this
-- migration does not add a new CHECK constraint, it relies on the
-- existing one as the last-resort guard.
--
-- 2c (Kreyòl error, no structure leak): 'Pa gen ase estòk pou "%" kounye
-- a.' names only the product (already known to the customer ordering
-- it -- not new information, no Kategori D concern) -- never the exact
-- remaining count, never a table/column name (Faz 2 Kategori C).
--
-- Etap 3 (idempotent restock): guarded by the order's OLD status
-- (captured before each function's own UPDATE), not a call counter, in
-- BOTH write paths that can reach a terminal state --
-- update_order_status_secure (customer/restaurant/admin cancel, and the
-- admin-only direct-to-'refunded' path the transition table technically
-- allows) and complete_refund_secure (the normal refund-request flow).
-- The "old status wasn't already terminal" guard is what prevents a
-- double credit if both paths somehow touch the same order.
--
-- ROLLBACK (manual, if ever needed): re-apply the three CREATE OR REPLACE
-- bodies exactly as they existed in the migrations named above (this
-- migration adds behavior via CREATE OR REPLACE, it does not change any
-- schema -- reverting is "put the old function body back", not a DROP).
--
-- APPLIED to production 2026-08-14 via the Management API
-- (database/query -- the SQL Editor equivalent, not `supabase db push`),
-- after the BEGIN...ROLLBACK test (docs/NKD010_STOCK_TEST.sql) was
-- actually executed and passed (5/5 assertions), and explicit owner
-- authorization ("ou ka aplike migrasyon an kounya"). Confirmed live
-- afterward via pg_proc. Full sequence, including a correction of an
-- earlier false "tests passed" claim made before the test had actually
-- been run, in docs/NKD-010_STOCK_LOGIC_REPORT.md.

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

    -- NKD-010: atomic decrement -- single conditional UPDATE, never a
    -- SELECT-then-UPDATE. NULL stock_quantity (D1: not every product
    -- tracks a count) bypasses this entirely.
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
  -- NKD-010: captured before this function's own UPDATE below overwrites
  -- v_order -- the idempotency guard for stock restock needs the status
  -- as it was walking in, not the new one.
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
    -- Checked before v_is_restaurant_owner/v_is_assigned_driver on
    -- purpose: those roles can never also be the customer on their own
    -- order, so there's no ordering conflict, but a customer's own cancel
    -- request must never fall through to a broader role's transition
    -- table by accident.
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
      -- MANUAL: moncash/natcash, not yet paid, and no payment_transactions
      -- row at all -- this payment never touched the automatic flow, so if
      -- it's not paid, the only way it ever becomes paid is an admin
      -- approving an uploaded proof.
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND NOT EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.' USING ERRCODE = '42501';
      END IF;
      -- AUTOMATIC: moncash/natcash, not yet paid, but a payment_transactions
      -- row exists -- this payment IS going through PLOP/Collect, waiting on
      -- the provider's own webhook (complete_collect_payment_secure), never
      -- an admin. Different cause, so a different message -- never implies
      -- proof review that isn't happening.
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

  -- NKD-010: return stock for every item on this order the first time it
  -- reaches a terminal cancelled/refunded state. Guarded by v_old_status
  -- (captured before this function's own UPDATE above), not a call
  -- counter -- the transition table already makes re-entry unreachable
  -- for every role except admin (v_allowed := true unconditionally,
  -- including a direct jump straight to 'refunded'); this guard also
  -- covers that path never double-crediting alongside
  -- complete_refund_secure below, which uses the identical guard.
  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  -- GPS-sharing auto-revocation gap found during the pre-deployment audit:
  -- private.protect_delivery_status_transition() already wipes
  -- customer_delivery_locations when *deliveries.status* reaches a
  -- terminal state, but this function only ever writes *orders.status*
  -- and never touches deliveries -- an admin force-cancelling an order
  -- that already has an active delivery (v_is_admin allows 'cancelled'
  -- from any status) would leave the delivery row, and therefore the
  -- customer's last shared position, untouched and still visible to the
  -- driver/admin. Cover every path through this function (not just the
  -- customer's) so "jamais visible après la fin de la livraison" holds
  -- regardless of which role ended it or how.
  IF _new_status IN ('cancelled', 'delivered') THEN
    DELETE FROM public.customer_delivery_locations
    WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE order_id = v_order.id);
  END IF;

  IF v_is_customer AND _new_status = 'cancelled' THEN
    PERFORM private.log_audit_event(v_user, 'customer', 'order.cancelled_by_customer',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));
    -- The customer already knows they just cancelled their own order --
    -- notify the restaurant and admin team instead of re-notifying them.
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

  -- NKD-010: same "old status wasn't already terminal" guard as
  -- update_order_status_secure -- if an admin already force-transitioned
  -- this order directly (bypassing the refund-request flow entirely),
  -- v_order_status already reflects that here, so this skips and never
  -- double-credits the same order's stock across both write paths.
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
