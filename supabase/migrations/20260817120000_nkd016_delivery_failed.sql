-- NKD-016 (part 2/2) — "failed delivery" business rule. Règ A5 raised for
-- this scope only (docs/archive/misc/PROTOKOL_FAZ3_A_FAZ11.md). Requires
-- 20260817110000_nkd016_delivery_failed_enum_values.sql already committed
-- (adds 'delivery_failed' to order_status/delivery_status and
-- 'driver_commission_delivery_failed' to commission_entry_type — this file
-- uses all three).
--
-- Business decisions (owner-confirmed, docs/archive/phases/NKD-016_FAILED_DELIVERY_REPORT.md):
--   - Address + phone mandatory for every order.
--   - Platform admin bears the loss; driver keeps their commission anyway
--     (they picked up and tried); restaurant is NOT credited (never delivered).
--   - Food returns to the admin office; customer has 2h, no refund.
--   - Cash: nothing was collected either way.
--   - 2h -> cancelled is a manual admin action (no scheduled-job
--     infrastructure exists in this project today).
--   - Rescheduling deferred to a follow-up ticket (NKD-017).
--
-- Architecture note (found during investigation, not assumed): the driver
-- app's own "Livre"/pickup buttons write to *deliveries.status*
-- (dashboard.driver.history.tsx:148), not orders.status directly.
-- private.protect_delivery_status_transition() (BEFORE UPDATE ON
-- deliveries) is the real gatekeeper and syncs orders.status afterward for
-- picked_up/delivered only. This migration extends that same trigger for
-- 'delivery_failed' rather than routing the driver's "Can't deliver"
-- button through private.update_order_status_secure, which the driver UI
-- does not use today.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_generate_driver_commission_on_delivery_failure ON public.orders;
--   DROP FUNCTION IF EXISTS private.generate_driver_commission_on_delivery_failure();
--   DROP INDEX IF EXISTS commission_ledger_order_driver_delivery_failed_uniq;
--   REVOKE ALL ON FUNCTION public.report_delivery_failed_secure(uuid, text, text) FROM authenticated;
--   DROP FUNCTION IF EXISTS public.report_delivery_failed_secure(uuid, text, text);
--   -- update_order_status_secure / protect_delivery_status_transition /
--   -- create_order_secure: re-apply the immediately-prior CREATE OR REPLACE
--   -- of each (20260814160000_nkd010_stock_decrement.sql,
--   -- 20260723090000_notifications_engine_and_gps_sharing.sql,
--   -- 20260816120000_nkd015_delivery_fee_config.sql respectively) verbatim.
--   -- private.generate_commission_for_order: re-apply the original body
--   -- verbatim (20260722120000_backfill_runs_and_commission_refactor.sql:129-207)
--   -- via CREATE OR REPLACE (it was originally a plain CREATE FUNCTION,
--   -- never redefined until this migration -- CREATE OR REPLACE against
--   -- the same signature (uuid, uuid, text) is still correct to revert it).
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_contact_phone_required;
--   DROP INDEX IF EXISTS orders_delivery_failed_at_idx;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_failed_at;
--   ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_failure_reason_valid;
--   ALTER TABLE public.deliveries DROP COLUMN IF EXISTS failure_reason;
--   ALTER TABLE public.deliveries DROP COLUMN IF EXISTS failure_comment;
--   -- The two new enum values (order_status/delivery_status) and the new
--   -- commission_entry_type value from part 1/2 are NOT reverted here --
--   -- see that file's own rollback note.

-- ---------------------------------------------------------------------------
-- 1) Schema: mandatory phone (DB-level, RPC already validated it -- this is
--    defense in depth against any future direct-write path); failure
--    reason/comment on the delivery attempt; a dedicated timestamp column
--    for the 2h window (status_history already records "when" inside a
--    jsonb array, but the admin screen needs to filter/sort on it directly).
ALTER TABLE public.orders
  ADD CONSTRAINT orders_contact_phone_required
  CHECK (contact_phone IS NOT NULL AND btrim(contact_phone) <> '');
-- 0 non-conforming rows confirmed by the project owner in SQL Editor,
-- 2026-08-17 -- applies directly, no NOT VALID / cleanup step needed.

ALTER TABLE public.orders ADD COLUMN delivery_failed_at timestamptz;
CREATE INDEX orders_delivery_failed_at_idx ON public.orders (delivery_failed_at)
  WHERE status = 'delivery_failed';

ALTER TABLE public.deliveries ADD COLUMN failure_reason text;
ALTER TABLE public.deliveries ADD COLUMN failure_comment text;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_failure_reason_valid
  CHECK (
    failure_reason IS NULL
    OR (
      failure_reason IN ('customer_unavailable', 'address_not_found', 'zone_inaccessible', 'other')
      AND (failure_reason <> 'other' OR (failure_comment IS NOT NULL AND btrim(failure_comment) <> ''))
    )
  );

-- ---------------------------------------------------------------------------
-- 2) private.create_order_secure -- same signature, same body, only the two
--    validation messages become Kreyòl (spec: user-facing errors in
--    Kreyòl, without revealing DB structure). The validations themselves
--    already existed (contact phone / delivery address were already
--    mandatory at the RPC level) -- this is not new enforcement, just the
--    wording the spec explicitly asked for.
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

-- ---------------------------------------------------------------------------
-- 3) private.protect_delivery_status_transition -- same signature (0-arg
--    trigger function). Extends the live version
--    (20260723090000_notifications_engine_and_gps_sharing.sql:259) with:
--    (a) picked_up -> delivery_failed AND en_route_dropoff -> delivery_failed
--        as legal driver transitions (a failed delivery is most often
--        discovered on arrival, i.e. from en_route_dropoff, not only right
--        after pickup),
--    (b) GPS auto-revocation also on delivery_failed (the attempt is over),
--    (c) orders.status + orders.delivery_failed_at synced in the same UPDATE.
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
      ('en_route_dropoff', 'delivered'),
      -- NKD-016 correction: the driver is most likely to discover a failed
      -- delivery *after* leaving the restaurant, not only right at pickup
      -- (customer doesn't answer / address not found happens on arrival,
      -- i.e. from en_route_dropoff). picked_up is kept too since the RPC
      -- also allows reporting immediately after pickup.
      ('picked_up', 'delivery_failed'), ('en_route_dropoff', 'delivery_failed')
    ) THEN
      RAISE EXCEPTION 'Illegal delivery status transition: % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'picked_up' AND OLD.picked_up_at IS NULL THEN
      NEW.picked_up_at := now();
    END IF;
    IF NEW.status = 'delivered' THEN
      NEW.delivered_at := now();
    END IF;

    IF NEW.status IN ('delivered', 'cancelled', 'delivery_failed') THEN
      DELETE FROM public.customer_delivery_locations WHERE delivery_id = NEW.id;
    END IF;

    -- Keep the order's own status in step with delivery progress.
    UPDATE public.orders o SET
      status = CASE NEW.status
        WHEN 'picked_up' THEN 'picked_up'::public.order_status
        WHEN 'delivered' THEN 'delivered'::public.order_status
        WHEN 'delivery_failed' THEN 'delivery_failed'::public.order_status
        ELSE o.status
      END,
      delivery_failed_at = CASE WHEN NEW.status = 'delivery_failed' THEN now() ELSE o.delivery_failed_at END,
      status_history = o.status_history || jsonb_build_object(
        'from', o.status, 'to', NEW.status, 'by', auth.uid(), 'at', now()
      ),
      updated_at = now()
    WHERE o.id = NEW.order_id
      AND NEW.status IN ('picked_up', 'delivered', 'delivery_failed');
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) private.update_order_status_secure -- same signature. Two changes vs
--    the live version (20260814160000_nkd010_stock_decrement.sql:203):
--    (a) the NKD-010 stock-return guard now excludes delivery_failed as a
--        source status -- the food was already made and handed to the
--        driver, it must NOT go back on the shelf when an admin later
--        moves delivery_failed -> cancelled (owner's decision, item 6);
--    (b) the customer notification on a delivery_failed -> cancelled admin
--        transition is a distinct "no refund, food no longer available"
--        message, not the generic "kòmand anile" one -- the "no refund"
--        part matters here specifically. Note: 'delivery_failed' itself
--        never reaches this function as _new_status (that transition
--        happens on deliveries.status via the trigger above); this
--        function only ever sees the *later* admin moves out of it.
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

  -- NKD-016: 'delivery_failed' excluded on top of the NKD-010 guard -- the
  -- food was already made and handed off, it must not return to stock
  -- when this order later reaches 'cancelled' from 'delivery_failed'.
  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded', 'delivery_failed') THEN
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
  ELSIF _new_status = 'cancelled' AND v_old_status = 'delivery_failed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a anile',
      'Kòmand ' || v_order.order_number || ' anile — manje a pa disponib ankò. Pa gen ranbousman, jan sa te make lè n te siyale pwoblèm livrezon an.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
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

-- ---------------------------------------------------------------------------
-- 5) public.report_delivery_failed_secure -- new, dedicated RPC for the
--    driver's "Pa ka livre" button (Q1 answer: dedicated RPC + both
--    enums, not a raw deliveries.update()). Validates reason/comment
--    server-side (the RPC is the authority, per spec item 1's phone rule
--    applied the same way here), writes deliveries.status = 'delivery_failed'
--    (which private.protect_delivery_status_transition above validates the
--    transition for, syncs orders.status + delivery_failed_at, and clears
--    GPS sharing for, all in the same UPDATE), then notifies customer
--    (in-app + push, time-boxed and actionable) and admin (in-app only,
--    same precedent as the Komand module -- admins already monitor that
--    dashboard). Driver commission crediting is NOT done here -- it is a
--    separate trigger on orders (§6 below), fired by the orders.status
--    sync this UPDATE triggers, so it is never skipped/duplicated
--    regardless of which caller reaches 'delivery_failed'.
CREATE OR REPLACE FUNCTION public.report_delivery_failed_secure(
  _order_id uuid,
  _reason text,
  _comment text DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_delivery public.deliveries;
  v_is_admin boolean;
  v_is_assigned_driver boolean;
  v_comment text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('report_delivery_failed', 20, 3600) THEN
    RAISE EXCEPTION 'Twòp rapò nan yon ti tan. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  IF _reason NOT IN ('customer_unavailable', 'address_not_found', 'zone_inaccessible', 'other') THEN
    RAISE EXCEPTION 'Rezon an pa valid.';
  END IF;
  v_comment := NULLIF(btrim(_comment), '');
  IF _reason = 'other' AND v_comment IS NULL THEN
    RAISE EXCEPTION 'Tanpri esplike rezon an lè w chwazi "lòt".';
  END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE order_id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Livrezon pa jwenn.';
  END IF;

  v_is_admin := public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin');
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_delivery.driver_id AND d.user_id = v_user
  );
  IF NOT (v_is_admin OR v_is_assigned_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- NKD-016 correction: a failed delivery is most often discovered on
  -- arrival (customer doesn't answer / address not found), i.e. from
  -- en_route_dropoff -- restricting this to 'picked_up' only left the
  -- driver stuck with no way to report it at the exact moment it's
  -- actually found out. Must match protect_delivery_status_transition's
  -- own whitelist above exactly, or one would silently reject what the
  -- other allows.
  IF v_delivery.status NOT IN ('picked_up', 'en_route_dropoff') THEN
    RAISE EXCEPTION 'Ou pa ka siyale yon echèk livrezon nan eta sa a.';
  END IF;

  UPDATE public.deliveries
     SET status = 'delivery_failed',
         failure_reason = _reason,
         failure_comment = v_comment,
         updated_at = now()
   WHERE id = v_delivery.id
   RETURNING * INTO v_delivery;

  PERFORM private.log_audit_event(v_user, CASE WHEN v_is_admin THEN 'admin' ELSE 'driver' END,
    'delivery.failed', jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason));

  INSERT INTO public.notifications (user_id, type, category, title, body, data)
  SELECT o.customer_id, 'order_status_changed', 'order', 'Nou pa t ka livre kòmand ou a',
    'Nou pa t ka livre kòmand ' || o.order_number || '. Manje a ap tann ou nan biwo nou an pou 2 èdtan.',
    jsonb_build_object('order_id', o.id, 'status', 'delivery_failed')
  FROM public.orders o WHERE o.id = _order_id;

  PERFORM private.notify_secure(
    ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
    'delivery_failed', 'order', 'Yon livrezon echwe',
    'Livrezon pou kòmand ' || (SELECT order_number FROM public.orders WHERE id = _order_id) || ' echwe — rezon: ' || _reason || '.',
    jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason)
  );

  RETURN v_delivery;
END;
$$;
REVOKE ALL ON FUNCTION public.report_delivery_failed_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_delivery_failed_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Driver commission on failed delivery -- separate trigger + function
--    (Q2 answer), never touches private.generate_commission_for_order /
--    private.generate_commission_on_delivery, which stay exactly as they
--    are for the 'delivered' path. Idempotent the same way the existing
--    engine is: ON CONFLICT DO NOTHING against a dedicated partial unique
--    index, so a delivery_failed processed twice (e.g. a retried client
--    call, or the trigger somehow firing again) credits the driver once.
CREATE UNIQUE INDEX commission_ledger_order_driver_delivery_failed_uniq
  ON public.commission_ledger (order_id, driver_id)
  WHERE entry_type = 'driver_commission_delivery_failed' AND driver_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.generate_driver_commission_on_delivery_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_driver_rate numeric;
  v_fee numeric;
  v_driver_net numeric;
  v_driver_commission numeric;
  v_ledger_id uuid;
  v_wallet_id uuid;
BEGIN
  SELECT dr.id, dr.commission_rate, d.fee INTO v_driver_id, v_driver_rate, v_fee
  FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.order_id = NEW.id AND d.driver_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_driver_net := ROUND(v_fee * v_driver_rate / 100, 2);
  v_driver_commission := v_fee - v_driver_net;

  INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount)
  VALUES (v_driver_id, NEW.id, 'driver_commission_delivery_failed', v_fee, v_driver_rate, v_driver_commission, v_driver_net)
  ON CONFLICT (order_id, driver_id) WHERE entry_type = 'driver_commission_delivery_failed' AND driver_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO public.wallets (driver_id, available_balance, lifetime_earnings)
    VALUES (v_driver_id, v_driver_net, v_driver_net)
    ON CONFLICT (driver_id) DO UPDATE SET
      available_balance = wallets.available_balance + v_driver_net,
      lifetime_earnings = wallets.lifetime_earnings + v_driver_net,
      updated_at = now()
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
    VALUES (v_wallet_id, 'commission_credit', v_driver_net, v_driver_net, v_ledger_id,
      'Komisyon sou livrezon echwe — kòmand ' || NEW.order_number);

    PERFORM private.log_audit_event(NULL, NULL, 'commission.created',
      jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'driver_id', v_driver_id,
        'net_amount', v_driver_net, 'entry_type', 'driver_commission_delivery_failed'));
    PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
      jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_driver_id, 'amount', v_driver_net));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_driver_commission_on_delivery_failure() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_generate_driver_commission_on_delivery_failure
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'delivery_failed' AND OLD.status IS DISTINCT FROM 'delivery_failed')
EXECUTE FUNCTION private.generate_driver_commission_on_delivery_failure();

-- ---------------------------------------------------------------------------
-- 7) DEFECT FIX (found in review, before this migration was ever applied):
--    double driver commission. Sequence that caused it: picked_up ->
--    delivery_failed credits the driver 150 HTG under entry_type
--    'driver_commission_delivery_failed' (§6 above); the customer then
--    picks the food up at the office and an admin moves the order
--    delivery_failed -> delivered; trg_generate_commission_on_delivery
--    (20260722100100_commission_engine.sql:143, unmodified, still fires on
--    any transition INTO 'delivered') then credits the SAME driver AGAIN,
--    150 HTG, under entry_type 'order_commission' -- a different
--    entry_type, so the existing ON CONFLICT idempotency guards (one per
--    entry_type, by design -- see 20260722100000_payout_wallet_schema.sql:98-110)
--    never see each other. 300 HTG paid for one delivery.
--
--    Fix: private.generate_commission_for_order -- same signature
--    (uuid, uuid, text), same body as the live version
--    (20260722120000_backfill_runs_and_commission_refactor.sql:129-207) --
--    the driver side only now skips crediting if a
--    'driver_commission_delivery_failed' row already exists for this
--    order+driver. The restaurant side is intentionally UNCHANGED: the
--    customer did receive the food when picking it up at the office, so
--    the restaurant still earned its commission on that sale -- only the
--    driver must not be paid twice for the same delivery.
CREATE OR REPLACE FUNCTION private.generate_commission_for_order(_order_id uuid, _actor_id uuid, _source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_calc record;
  v_ledger_id uuid;
  v_wallet_id uuid;
  v_note_suffix text;
  v_role text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_note_suffix := CASE WHEN _source = 'backfill' THEN ' (backfill istorik)' ELSE '' END;
  v_role := CASE WHEN _source = 'backfill' THEN 'admin' ELSE NULL END;

  SELECT * INTO v_calc FROM private.compute_order_commission_preview(_order_id);

  -- Restaurant side (unchanged -- see header comment above)
  INSERT INTO public.commission_ledger (restaurant_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount, created_by)
  VALUES (v_order.restaurant_id, v_order.id, 'order_commission', v_order.subtotal, v_calc.restaurant_commission_rate, v_calc.restaurant_commission_amount, v_calc.restaurant_net_amount, _actor_id)
  ON CONFLICT (order_id, restaurant_id) WHERE entry_type = 'order_commission' AND restaurant_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO public.wallets (restaurant_id, available_balance, lifetime_earnings)
    VALUES (v_order.restaurant_id, v_calc.restaurant_net_amount, v_calc.restaurant_net_amount)
    ON CONFLICT (restaurant_id) DO UPDATE SET
      available_balance = wallets.available_balance + v_calc.restaurant_net_amount,
      lifetime_earnings = wallets.lifetime_earnings + v_calc.restaurant_net_amount,
      updated_at = now()
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, created_by, note)
    VALUES (v_wallet_id, 'commission_credit', v_calc.restaurant_net_amount, v_calc.restaurant_net_amount, v_ledger_id, _actor_id, 'Commission sou kòmand ' || v_order.order_number || v_note_suffix);

    PERFORM private.log_audit_event(_actor_id, v_role, 'commission.created',
      jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', v_order.id, 'restaurant_id', v_order.restaurant_id, 'net_amount', v_calc.restaurant_net_amount, 'source', _source));
    PERFORM private.log_audit_event(_actor_id, v_role, 'wallet.credited',
      jsonb_build_object('wallet_id', v_wallet_id, 'restaurant_id', v_order.restaurant_id, 'amount', v_calc.restaurant_net_amount, 'source', _source));
  END IF;

  -- Driver side (skipped entirely if no assigned driver on this order) --
  -- NKD-016 fix: also skipped if this driver was already paid for this
  -- order via the delivery_failed path (§6 above) -- that commission is
  -- final and must not be paid a second time under 'order_commission' just
  -- because the order later reaches 'delivered' anyway (office pickup).
  IF v_calc.driver_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.commission_ledger cl
       WHERE cl.order_id = v_order.id
         AND cl.driver_id = v_calc.driver_id
         AND cl.entry_type = 'driver_commission_delivery_failed'
     ) THEN
    v_ledger_id := NULL;

    INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount, created_by)
    VALUES (v_calc.driver_id, v_order.id, 'order_commission', v_calc.driver_fee, v_calc.driver_commission_rate, v_calc.driver_commission_amount, v_calc.driver_net_amount, _actor_id)
    ON CONFLICT (order_id, driver_id) WHERE entry_type = 'order_commission' AND driver_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      INSERT INTO public.wallets (driver_id, available_balance, lifetime_earnings)
      VALUES (v_calc.driver_id, v_calc.driver_net_amount, v_calc.driver_net_amount)
      ON CONFLICT (driver_id) DO UPDATE SET
        available_balance = wallets.available_balance + v_calc.driver_net_amount,
        lifetime_earnings = wallets.lifetime_earnings + v_calc.driver_net_amount,
        updated_at = now()
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, created_by, note)
      VALUES (v_wallet_id, 'commission_credit', v_calc.driver_net_amount, v_calc.driver_net_amount, v_ledger_id, _actor_id, 'Komisyon sou kòmand ' || v_order.order_number || v_note_suffix);

      PERFORM private.log_audit_event(_actor_id, v_role, 'commission.created',
        jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', v_order.id, 'driver_id', v_calc.driver_id, 'net_amount', v_calc.driver_net_amount, 'source', _source));
      PERFORM private.log_audit_event(_actor_id, v_role, 'wallet.credited',
        jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_calc.driver_id, 'amount', v_calc.driver_net_amount, 'source', _source));
    END IF;
  END IF;
END;
$$;
