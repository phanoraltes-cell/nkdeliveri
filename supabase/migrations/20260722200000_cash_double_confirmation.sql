-- Phase 4 of the admin evolution plan: double confirmation for cash
-- ('kach') orders. Confirmed by research: 'kach' is already a real,
-- selectable checkout payment method, but no RPC anywhere ever advances
-- its payments.status past 'pending' -- there is no reconciliation
-- mechanism at all today. This adds one, as a parallel layer that never
-- touches the commission trigger: trg_generate_commission_on_delivery
-- fires on orders.status = 'delivered' only and has never read
-- payments.status, and nothing here changes that -- confirmed by
-- re-reading 20260722100100_commission_engine.sql before writing this
-- file. A cash mismatch becomes a dispute (the existing disputes system),
-- it never blocks or reverses a commission already credited.

CREATE TYPE public.cash_confirmation_status AS ENUM
  ('pending', 'customer_confirmed', 'driver_confirmed', 'validated', 'disputed');

ALTER TABLE public.payments ADD COLUMN cash_confirmation_status public.cash_confirmation_status;
ALTER TABLE public.payments ADD COLUMN customer_confirmed_at timestamptz;
ALTER TABLE public.payments ADD COLUMN driver_confirmed_at timestamptz;
-- NULL for every non-cash payment (moncash/natcash/stripe), untouched.
-- Backfill existing kach rows so the frontend's "needs confirmation" check
-- has consistent data for orders that predate this migration too.
UPDATE public.payments SET cash_confirmation_status = 'pending'
WHERE method = 'kach' AND cash_confirmation_status IS NULL;

-- The assigned driver could not previously SELECT a payments row at all
-- (the original policy only covered customer/admin/restaurant owner) --
-- needed now so the driver's delivery UI can see whether a kach order's
-- payment needs confirming. Purely additive (adds a visibility clause,
-- removes none), same "assigned driver" check already used on
-- deliveries/disputes RLS elsewhere in this project.
DROP POLICY IF EXISTS "payments read" ON public.payments;
CREATE POLICY "payments read" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payments.order_id AND (
    o.customer_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
      WHERE de.order_id = o.id AND dr.user_id = auth.uid()
    )
  )));

-- Same signature as 20260718160000_restaurant_payout_always_via_admin.sql
-- -- no DROP needed. Only addition: a kach payment is seeded with
-- cash_confirmation_status = 'pending' at creation time, exactly like
-- every other column already set on this INSERT. Nothing else in this
-- function changes.
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
  v_cash_status := CASE WHEN _method = 'kach' THEN 'pending'::public.cash_confirmation_status ELSE NULL END;

  IF _method IN ('moncash', 'natcash') THEN
    SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
      INTO v_platform FROM public.platform_payout_settings WHERE id = true;
    -- SELECT INTO a record leaves it as NULL fields on zero rows rather than
    -- raising, which would otherwise silently insert a NULL receiver_number
    -- for every manual-payment order — fail loudly instead so an admin
    -- notices immediately rather than customers seeing "(pa konfigire)".
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

-- Extended (Phase 4) to also let the order's assigned driver open a
-- dispute -- previously customer-only (the WHERE clause on the initial
-- SELECT required customer_id = auth.uid()), which the cash
-- double-confirmation flow needs on both sides ("Sa a pa kòrèk" for
-- either party). `disputes.customer_id` always stays the order's real
-- customer regardless of who opens it -- only the authorization check
-- and the message's author_role attribution change; category
-- validation, rate limiting, the upsert-to-reopen logic, and the
-- restaurant-owner notification are all unchanged.
CREATE OR REPLACE FUNCTION public.open_dispute_secure(_order_id uuid, _category text, _description text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_driver_id uuid;
  v_row public.disputes;
  v_author_role public.dispute_author_role;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _description IS NULL OR length(btrim(_description)) < 5 THEN
    RAISE EXCEPTION 'Tanpri eksplike pwoblèm nan (omwen 5 karaktè)';
  END IF;
  IF _category IS NULL OR length(btrim(_category)) = 0 THEN
    RAISE EXCEPTION 'Chwazi yon kategori';
  END IF;

  IF NOT public.check_rate_limit_secure('open_dispute', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  SELECT dr.id INTO v_driver_id
  FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
  WHERE de.order_id = _order_id;

  IF NOT (
    v_order.customer_id = v_user
    OR (v_driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.id = v_driver_id AND dr.user_id = v_user))
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.disputes (order_id, customer_id, restaurant_id, driver_id, category)
  VALUES (_order_id, v_order.customer_id, v_order.restaurant_id, v_driver_id, btrim(_category))
  ON CONFLICT (order_id) DO UPDATE SET
    -- A previous dispute on this order was resolved — a new problem reopens it.
    status = 'open', category = EXCLUDED.category, driver_id = EXCLUDED.driver_id,
    resolution = NULL, resolved_by = NULL, resolved_at = NULL, updated_at = now()
  WHERE disputes.status = 'resolved'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gen deja yon litij louvri pou kòmand sa a';
  END IF;

  v_author_role := private.dispute_author_role(v_row);

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (v_row.id, v_user, COALESCE(v_author_role, 'customer'), btrim(_description));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.owner_id, 'dispute_opened', 'Nouvo litij sou yon kòmand',
    'Yon ' || (CASE WHEN v_author_role = 'driver' THEN 'livrè' ELSE 'kliyan' END)
      || ' siyale yon pwoblèm sou kòmand ' || v_order.order_number || '.',
    jsonb_build_object('order_id', v_order.id, 'dispute_id', v_row.id)
  FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.open_dispute_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_dispute_secure(uuid, text, text) TO authenticated;

-- Caller's role (customer vs driver) is auto-detected from auth.uid(),
-- never taken as a client-supplied parameter — nothing to validate
-- because nothing is trusted from the client beyond the order id.
-- Idempotent: a second tap by the same party is a no-op (returns the
-- current row, no error) rather than failing.
CREATE FUNCTION public.confirm_cash_payment_secure(_order_id uuid)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_is_driver boolean;
  v_row public.payments;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_is_driver := EXISTS (
    SELECT 1 FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
    WHERE de.order_id = _order_id AND dr.user_id = v_user
  );

  IF NOT (v_order.customer_id = v_user OR v_is_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_driver THEN
    UPDATE public.payments SET driver_confirmed_at = now(), updated_at = now()
    WHERE order_id = _order_id AND method = 'kach' AND driver_confirmed_at IS NULL
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.payments SET customer_confirmed_at = now(), updated_at = now()
    WHERE order_id = _order_id AND method = 'kach' AND customer_confirmed_at IS NULL
    RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.payments WHERE order_id = _order_id AND method = 'kach';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pa gen peman kach pou kòmand sa a';
    END IF;
    RETURN v_row;
  END IF;

  IF v_row.customer_confirmed_at IS NOT NULL AND v_row.driver_confirmed_at IS NOT NULL THEN
    UPDATE public.payments SET status = 'paid', cash_confirmation_status = 'validated', updated_at = now()
    WHERE id = v_row.id RETURNING * INTO v_row;
  ELSIF v_row.customer_confirmed_at IS NOT NULL THEN
    UPDATE public.payments SET cash_confirmation_status = 'customer_confirmed', updated_at = now()
    WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    UPDATE public.payments SET cash_confirmation_status = 'driver_confirmed', updated_at = now()
    WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  PERFORM private.log_audit_event(v_user, CASE WHEN v_is_driver THEN 'driver' ELSE 'customer' END,
    'cash_payment.confirmed', jsonb_build_object('order_id', _order_id, 'payment_id', v_row.id));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_cash_payment_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_cash_payment_secure(uuid) TO authenticated;

-- Reuses open_dispute_secure entirely (rate limiting, validation,
-- author attribution, notification) — this wrapper only adds the
-- cash-specific bookkeeping on top, so there is exactly one place a
-- dispute actually gets created. Authorization is enforced by
-- open_dispute_secure itself (customer or the assigned driver).
CREATE FUNCTION public.dispute_cash_payment_secure(_order_id uuid, _description text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.disputes;
BEGIN
  SELECT * INTO v_dispute FROM public.open_dispute_secure(_order_id, 'Peman kach pa kòrèk', _description);

  UPDATE public.payments SET cash_confirmation_status = 'disputed', updated_at = now()
  WHERE order_id = _order_id AND method = 'kach';

  RETURN v_dispute;
END;
$$;
REVOKE ALL ON FUNCTION public.dispute_cash_payment_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispute_cash_payment_secure(uuid, text) TO authenticated;
