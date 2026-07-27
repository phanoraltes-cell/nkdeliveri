-- NK Deliveri — "Suivi temps réel, Chat, Annulation" phase (v7 of the plan).
-- This first migration lays two independent foundations: (1) a generic
-- notification engine (private.notify_secure) that the upcoming chat
-- feature will use instead of becoming an 8th hand-copied
-- send-X-push.functions.ts, and (2) opt-in customer GPS sharing during an
-- active delivery. Neither touches the Commission Engine, Wallet, or any
-- existing order/delivery status transition logic.

-- ---------------------------------------------------------------------------
-- PART A — Notification engine foundation
-- ---------------------------------------------------------------------------

-- `category` groups the ~15 existing free-text `type` values (grep
-- confirmed: dispute_*, refund_*, payment_*, payout_*, commission_*,
-- order_status_changed, employee_*, new_promotion, driver_status_changed)
-- for the future notification-center filter tabs. Existing rows are
-- backfilled by prefix match; this is presentation metadata only, never
-- read by any existing RPC, so a best-effort backfill is safe.
ALTER TABLE public.notifications ADD COLUMN category text NOT NULL DEFAULT 'system'
  CHECK (category IN ('order', 'delivery', 'payment', 'commission', 'promotion', 'dispute', 'system'));

UPDATE public.notifications SET category = CASE
  WHEN type LIKE 'dispute_%' THEN 'dispute'
  WHEN type LIKE 'refund_%' OR type LIKE 'payment_%' THEN 'payment'
  WHEN type LIKE 'payout_%' OR type LIKE '%commission%' THEN 'commission'
  WHEN type = 'new_promotion' THEN 'promotion'
  WHEN type IN ('order_status_changed') THEN 'order'
  WHEN type = 'driver_status_changed' THEN 'delivery'
  ELSE 'system'
END
WHERE category = 'system';

-- Per-user, per-category opt-out. A flexible jsonb bag (not one column per
-- category) so adding a category later is a CHECK-constraint edit, not a
-- migration. Missing key = enabled (opt-out model, matches "notifications
-- automatiques" being the default for every category except promotions,
-- which private.notify_secure below defaults to false explicitly).
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon;
GRANT SELECT ON public.notification_preferences TO authenticated;
CREATE POLICY "notification_preferences own" ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- Writes only via the RPC below (never a raw upsert) so a malformed
-- category key can't silently disable a category check.

CREATE OR REPLACE FUNCTION public.update_notification_preferences_secure(_prefs jsonb)
RETURNS public.notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.notification_preferences;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_prefs) <> 'object' THEN
    RAISE EXCEPTION 'Preferences must be a JSON object';
  END IF;

  INSERT INTO public.notification_preferences (user_id, prefs, updated_at)
  VALUES (v_user, _prefs, now())
  ON CONFLICT (user_id) DO UPDATE SET prefs = _prefs, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_notification_preferences_secure(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences_secure(jsonb) TO authenticated;

-- The generic engine every NEW notification-emitting feature (chat, GPS
-- sharing, customer cancellation) calls instead of hand-writing its own
-- `INSERT INTO notifications`. The ~15 existing call sites are left as-is
-- deliberately -- retrofitting an already-audited financial/dispute
-- pipeline is out of scope for this pass (see plan). `_category = 'promotion'`
-- defaults to opt-in-required (skipped unless the user explicitly enabled
-- it); every other category defaults to enabled (skipped only on explicit
-- opt-out) -- matches "le client peut recevoir des notifications
-- promotionnelles s'il les a autorisées" being the one category that isn't
-- on by default.
CREATE OR REPLACE FUNCTION private.notify_secure(
  _user_ids uuid[], _type text, _category text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, category, title, body, data)
  SELECT uid, _type, _category, _title, _body, _data
  FROM unnest(_user_ids) AS uid
  WHERE uid IS NOT NULL
    AND (
      CASE
        WHEN _category = 'promotion' THEN
          COALESCE((private.notification_preferences_for(uid)->>'promotion')::boolean, false)
        ELSE
          COALESCE((private.notification_preferences_for(uid)->>_category)::boolean, true)
      END
    );
END;
$$;
REVOKE ALL ON FUNCTION private.notify_secure(uuid[], text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notification_preferences_for(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT prefs FROM public.notification_preferences WHERE user_id = _user_id), '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION private.notification_preferences_for(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PART B — Customer GPS sharing (opt-in, active-delivery-only, auto-revoked)
-- ---------------------------------------------------------------------------

-- Consent record captured at checkout. Purely a record of explicit intent
-- -- it does not itself start any tracking (the browser requires a fresh
-- user gesture to call watchPosition anyway, so this can never silently
-- auto-activate anything).
ALTER TABLE public.orders ADD COLUMN wants_location_sharing boolean NOT NULL DEFAULT false;

-- Separate table, not new columns on `deliveries`: the `deliveries` SELECT
-- policy already (correctly) includes the restaurant owner/staff, since
-- they need delivery status for their Kanban. RLS is row-level, not
-- column-level, so customer_lat/lng could not be hidden from the
-- restaurant if it lived on that same row. A dedicated table with its own
-- policy is the only way to satisfy "visible uniquement par le client, le
-- livreur affecté, les administrateurs -- jamais un autre utilisateur"
-- (the restaurant is explicitly "un autre utilisateur" here).
-- One row per delivery (PK = delivery_id, always upserted) -- by
-- construction there is never a location history, only the latest fix.
CREATE TABLE public.customer_delivery_locations (
  delivery_id uuid PRIMARY KEY REFERENCES public.deliveries(id) ON DELETE CASCADE,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  accuracy numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_delivery_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_delivery_locations REPLICA IDENTITY FULL;

REVOKE ALL ON public.customer_delivery_locations FROM PUBLIC, anon;
GRANT SELECT ON public.customer_delivery_locations TO authenticated;

CREATE POLICY "customer_delivery_locations read" ON public.customer_delivery_locations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.deliveries d JOIN public.orders o ON o.id = d.order_id
      WHERE d.id = customer_delivery_locations.delivery_id AND o.customer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
      WHERE d.id = customer_delivery_locations.delivery_id AND dr.user_id = auth.uid()
    )
  );
-- No restaurant clause anywhere in this policy -- deliberate, not an
-- oversight. No direct INSERT/UPDATE/DELETE grant either -- the RPC below
-- is the only write path, so a customer can never touch any column but
-- lat/lng/accuracy even via a hand-crafted request (a raw RLS UPDATE grant
-- could not make that column-level guarantee).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customer_delivery_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_delivery_locations;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.push_customer_location_secure(
  _delivery_id uuid, _lat numeric, _lng numeric, _accuracy numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_delivery record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _lat IS NULL OR _lng IS NULL OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  SELECT d.id, d.status, o.customer_id INTO v_delivery
  FROM public.deliveries d JOIN public.orders o ON o.id = d.order_id
  WHERE d.id = _delivery_id;
  IF NOT FOUND OR v_delivery.customer_id <> v_user THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_delivery.status NOT IN ('assigned', 'en_route_pickup', 'picked_up', 'en_route_dropoff') THEN
    RAISE EXCEPTION 'Livrezon sa a pa aktif';
  END IF;

  INSERT INTO public.customer_delivery_locations (delivery_id, lat, lng, accuracy, updated_at)
  VALUES (_delivery_id, _lat, _lng, _accuracy, now())
  ON CONFLICT (delivery_id) DO UPDATE SET
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy = EXCLUDED.accuracy, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.push_customer_location_secure(uuid, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_customer_location_secure(uuid, numeric, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.stop_customer_location_sharing_secure(_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.customer_delivery_locations cdl
  USING public.deliveries d, public.orders o
  WHERE cdl.delivery_id = _delivery_id AND d.id = cdl.delivery_id AND o.id = d.order_id
    AND o.customer_id = v_user;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_customer_location_sharing_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stop_customer_location_sharing_secure(uuid) TO authenticated;

-- Auto-revocation: real deletion (not a hidden/inactive flag) the moment a
-- delivery reaches a terminal state, regardless of which path got it
-- there (normal delivered flow, or an admin-cancelled delivery) --
-- "l'accès doit être révoqué" satisfied literally, not just hidden by RLS.
CREATE OR REPLACE FUNCTION private.protect_delivery_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_is_assigned_driver boolean;
BEGIN
  v_is_admin := private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin');

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can reassign a delivery' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_admin THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'Cannot change order_id' USING ERRCODE = '42501';
    END IF;
    IF NEW.fee IS DISTINCT FROM OLD.fee THEN
      RAISE EXCEPTION 'Cannot change fee' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_is_assigned_driver := EXISTS (
      SELECT 1 FROM public.drivers d WHERE d.id = OLD.driver_id AND d.user_id = auth.uid()
    );
    IF NOT (v_is_admin OR v_is_assigned_driver) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_admin AND (OLD.status, NEW.status) NOT IN (
      ('assigned', 'en_route_pickup'), ('assigned', 'picked_up'),
      ('en_route_pickup', 'picked_up'),
      ('picked_up', 'en_route_dropoff'), ('picked_up', 'delivered'),
      ('en_route_dropoff', 'delivered')
    ) THEN
      RAISE EXCEPTION 'Illegal delivery status transition: % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'picked_up' AND OLD.picked_up_at IS NULL THEN
      NEW.picked_up_at := now();
    END IF;
    IF NEW.status = 'delivered' THEN
      NEW.delivered_at := now();
    END IF;

    IF NEW.status IN ('delivered', 'cancelled') THEN
      DELETE FROM public.customer_delivery_locations WHERE delivery_id = NEW.id;
    END IF;

    -- Keep the order's own status in step with delivery progress.
    UPDATE public.orders o SET
      status = CASE NEW.status
        WHEN 'picked_up' THEN 'picked_up'::public.order_status
        WHEN 'delivered' THEN 'delivered'::public.order_status
        ELSE o.status
      END,
      status_history = o.status_history || jsonb_build_object(
        'from', o.status, 'to', NEW.status, 'by', auth.uid(), 'at', now()
      ),
      updated_at = now()
    WHERE o.id = NEW.order_id
      AND NEW.status IN ('picked_up', 'delivered');
  END IF;

  RETURN NEW;
END;
$$;
-- Same signature (0-arg trigger function) -- no DROP/GRANT changes needed.

-- create_order_secure gains _wants_location_sharing (new trailing param
-- with a default -> the checkout call site keeps working unchanged).
-- Both the private implementation and its public SQL wrapper (which the
-- client actually calls) need the new param -- the wrapper is a thin
-- passthrough, not duplicated logic.
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method);
CREATE FUNCTION private.create_order_secure(
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
-- Signature grew a defaulted trailing param -> not a hazard for the
-- private function itself (nothing else calls it positionally with a
-- differing arg count), but the public wrapper below IS a real signature
-- change for check-migration-hazards.mjs purposes, hence the DROP there.

DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method);
CREATE FUNCTION public.create_order_secure(
  _restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text,
  _delivery_notes text, _method public.payment_method, _wants_location_sharing boolean DEFAULT false
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method, _wants_location_sharing
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean) TO authenticated;
