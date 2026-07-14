-- Security remediation (Phase 1, item 3): generic rate limiting, enforced
-- inside the RPC layer itself (not left to the client to call), so it can't
-- be bypassed by simply not calling a "check" endpoint.
--
-- Design: a small fixed-window counter table + one SECURITY DEFINER function
-- that increments and checks it atomically. The actor identity is always
-- derived from auth.uid() for ordinary authenticated callers — a caller can
-- never pass a key that impersonates another user. The one exception is
-- service_role (auth.uid() IS NULL in that context, e.g. TanStack server
-- functions using supabaseAdmin before the target user has a session, such
-- as finalizeRegistrationDocuments during signup) which may pass an explicit
-- _actor_override; that path is only reachable with the service role key,
-- which never leaves the server (see src/integrations/supabase/client.server.ts).

CREATE TABLE IF NOT EXISTS private.rate_limit_hits (
  rl_key text NOT NULL,
  window_start timestamptz NOT NULL,
  hit_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (rl_key, window_start)
);

ALTER TABLE private.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- No policies: the `private` schema is never exposed via PostgREST (see
-- supabase/config.toml — only `public`/`graphql_public` are), so this table
-- is unreachable by anyone except SECURITY DEFINER functions running as
-- their owner. RLS is enabled anyway for defense-in-depth consistency with
-- every other table in this project.
REVOKE ALL ON private.rate_limit_hits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_rate_limit_secure(
  _action text,
  _max_hits int,
  _window_seconds int,
  _actor_override text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_key text;
  v_window timestamptz;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role context only (no JWT subject) — the caller must name who
    -- this check is for. Ordinary authenticated/anon PostgREST calls always
    -- carry a JWT once past GoTrue, so this branch is not reachable with the
    -- publishable key.
    IF _actor_override IS NULL OR length(btrim(_actor_override)) = 0 THEN
      RAISE EXCEPTION 'actor required for service-role rate limit checks' USING ERRCODE = '42501';
    END IF;
    v_actor := _actor_override;
  ELSE
    v_actor := auth.uid()::text;
  END IF;

  IF _max_hits IS NULL OR _max_hits <= 0 OR _window_seconds IS NULL OR _window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  v_key := _action || ':' || v_actor;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO private.rate_limit_hits (rl_key, window_start, hit_count)
  VALUES (v_key, v_window, 1)
  ON CONFLICT (rl_key, window_start)
  DO UPDATE SET hit_count = private.rate_limit_hits.hit_count + 1
  RETURNING hit_count INTO v_count;

  -- Best-effort cleanup of old windows for this key (cheap: same PK prefix).
  DELETE FROM private.rate_limit_hits
  WHERE rl_key = v_key AND window_start < v_window - make_interval(secs => _window_seconds * 4);

  RETURN v_count <= _max_hits;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit_secure(text, int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_secure(text, int, int, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Apply the guard to the highest-abuse-value RPCs. Every function below is
-- CREATE OR REPLACE with its EXACT current signature (verified against the
-- live migration history) — only the rate-limit check is inserted at the
-- top of each body, no other logic changes. Same signature means Postgres
-- replaces the function in place; it does not create a second overload (the
-- hazard documented in 20260709070000_fix_menu_overload_and_commission_admin.sql
-- only applies when the argument list itself changes).

-- 1) Order creation — 8 orders / 10 minutes / customer.
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

-- 2) Payment proof submission — 5 submissions / 10 minutes / customer.
CREATE OR REPLACE FUNCTION public.submit_payment_proof_secure(
  _payment_id uuid,
  _file_url text,
  _transaction_ref text,
  _sender_phone text,
  _notes text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments;
  v_row public.payments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('submit_payment_proof', 5, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE p.id = _payment_id AND o.customer_id = auth.uid()
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '42501';
  END IF;

  IF v_payment.status NOT IN ('awaiting_proof', 'pending') THEN
    RAISE EXCEPTION 'This payment is not awaiting proof';
  END IF;

  INSERT INTO public.payment_proofs (payment_id, file_url, transaction_ref, sender_phone, notes, uploaded_by)
  VALUES (_payment_id, _file_url, _transaction_ref, _sender_phone, _notes, auth.uid());

  UPDATE public.payments SET
    status = 'under_review',
    transaction_ref = COALESCE(_transaction_ref, transaction_ref),
    sender_phone = COALESCE(_sender_phone, sender_phone)
  WHERE id = _payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_payment_proof_secure(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_payment_proof_secure(uuid, text, text, text, text) TO authenticated;

-- 3) Delivery claiming — 20 attempts / 5 minutes / driver (generous: rush
--    periods legitimately mean rapid-fire attempts on contested orders).
CREATE OR REPLACE FUNCTION private.claim_delivery_secure(_order_id uuid)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers;
  v_order public.orders;
  v_row public.deliveries;
BEGIN
  IF NOT public.check_rate_limit_secure('claim_delivery', 20, 300) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a driver account can claim deliveries';
  END IF;
  IF v_driver.status <> 'online' THEN
    RAISE EXCEPTION 'You must be online to claim a delivery';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'ready' THEN
    RAISE EXCEPTION 'Order is not ready for pickup';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = _order_id) THEN
    RAISE EXCEPTION 'This order has already been claimed';
  END IF;

  INSERT INTO public.deliveries (order_id, driver_id, status, fee)
  VALUES (_order_id, v_driver.id, 'assigned', COALESCE(v_order.delivery_fee, 0))
  RETURNING * INTO v_row;

  UPDATE public.orders SET
    status = 'assigned',
    status_history = status_history || jsonb_build_object(
      'from', v_order.status, 'to', 'assigned', 'by', auth.uid(), 'at', now()
    ),
    updated_at = now()
  WHERE id = _order_id;

  RETURN v_row;
END;
$$;

-- 4) Restaurant staff invitations — 10 invitations / 60 minutes / owner.
CREATE OR REPLACE FUNCTION public.add_restaurant_employee_secure(_restaurant_id uuid, _email text)
RETURNS public.restaurant_employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_owner_id uuid;
  v_row public.restaurant_employees;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('add_restaurant_employee', 10, 3600) THEN
    RAISE EXCEPTION 'Twòp envitasyon nan yon ti tan. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  SELECT id INTO v_target_user_id FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Pa gen kont ak imèl sa a. Mande moun sa a kreye yon kont NK Deliveri dabò.';
  END IF;

  IF v_target_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Moun sa a se pwopriyetè restoran an deja';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_employees
    WHERE restaurant_id = _restaurant_id AND user_id = v_target_user_id
  ) THEN
    RAISE EXCEPTION 'Moun sa a deja yon anplwaye pou restoran sa a';
  END IF;

  INSERT INTO public.restaurant_employees (restaurant_id, user_id, role)
  VALUES (_restaurant_id, v_target_user_id, 'staff')
  RETURNING * INTO v_row;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_target_user_id, 'restaurant_staff')
  ON CONFLICT DO NOTHING;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_restaurant_employee_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_restaurant_employee_secure(uuid, text) TO authenticated;
