-- NKD-015: platform-controlled delivery fee (docs/archive/phases/PHASE10_BUSINESS_LOGIC_AUDIT.md §6).
-- Business decision, explicitly specified by the project owner (see
-- docs/archive/phases/NKD-015_DELIVERY_FEE_REPORT.md for the full spec + D-question
-- answers). Règ A5 raised for this scope only.
--
-- Decisions confirmed:
--   - Admin sets the price, not the restaurant.
--   - Structure: a zone table (name + fee) with exactly one default zone,
--     not a single flat value -- chosen over the simpler single-value
--     option for future multi-zone growth, even though today (Gonaïves
--     only) every order uses the default zone.
--   - No address<->zone matching mechanism in this phase -- every order
--     uses the default zone's fee. The table shape is ready for real
--     zone matching later without another schema migration.
--
-- Effects on the rest of the system, verified from source before writing
-- this (not assumed) -- none required a code change:
--   - Restaurant commission (private trigger in
--     20260722100100_commission_engine.sql:76) is computed on
--     NEW.subtotal only -- already excludes delivery_fee, unaffected.
--   - Driver commission is computed on deliveries.fee (same file:110),
--     which is set to COALESCE(orders.delivery_fee, 0) at claim time
--     (private.claim_delivery_secure) -- already correctly scales with
--     whatever delivery_fee actually is.
--   - Refunds (20260714130000_refunds.sql:102) refund
--     payments.amount = orders.subtotal + delivery_fee + service_fee in
--     full -- already includes delivery_fee, no special-casing needed.
--   - Payment reconciliation reconciles against payments.amount, which
--     already includes delivery_fee for the same reason.
--
-- Dead code removed per explicit instruction: create_order_secure's
-- COALESCE(v_restaurant.delivery_fee, 150) fallback is gone. It could
-- never actually fire (restaurants.delivery_fee is NOT NULL DEFAULT 0,
-- never NULL), so removing it changes no behavior by itself -- the real
-- behavior change is switching the *source* from restaurants.delivery_fee
-- to platform_delivery_zones.
--
-- restaurants.delivery_fee itself is NOT dropped and NOT touched here --
-- doing so would require updating every display site that still reads it
-- (popular-restaurants-section.tsx, restaurants.$slug.tsx,
-- restaurants.index.tsx's 2 spots) as its own migration/cleanup, which is
-- outside "a platform config table + create_order_secure" as specified.
-- Those 4 display sites ARE updated in this same change (frontend
-- section) to read the new platform fee instead, because leaving them
-- showing the now-permanently-stale restaurants.delivery_fee value next
-- to a checkout page showing the real fee would be a visible, confusing
-- inconsistency this same change would have caused -- not scope creep,
-- a direct and necessary consequence of moving the source of truth.
--
-- ROLLBACK (manual, if ever needed):
--   -- 1. Restore the old create_order_secure body (COALESCE(v_restaurant.delivery_fee, 150))
--   --    from supabase/migrations/20260814160000_nkd010_stock_decrement.sql.
--   -- 2. DROP FUNCTION IF EXISTS public.update_delivery_zone_fee_secure(uuid, numeric);
--   -- 3. DROP TABLE IF EXISTS public.platform_delivery_zones;
--   Safe to drop -- no other table references platform_delivery_zones by FK,
--   orders.delivery_fee already stores its own frozen copy per order.

CREATE TABLE public.platform_delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  fee_htg numeric(10,2) NOT NULL CHECK (fee_htg >= 0),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- At most one default zone, ever -- create_order_secure below relies on
-- exactly one existing.
CREATE UNIQUE INDEX platform_delivery_zones_one_default
  ON public.platform_delivery_zones (is_default)
  WHERE is_default = true;

-- Seed: one zone, so the table is never empty (create_order_secure would
-- have nothing to read otherwise). 150 HTG chosen as the initial value
-- for continuity with the number the old dead COALESCE fallback used --
-- NOT re-derived from any business requirement, since none was given for
-- the exact starting price. The admin screen this migration also ships
-- (§ frontend) lets this be corrected immediately after deploy if 150 is
-- wrong.
INSERT INTO public.platform_delivery_zones (name, fee_htg, is_default)
VALUES ('Gonaïves', 150, true);

ALTER TABLE public.platform_delivery_zones ENABLE ROW LEVEL SECURITY;

-- Public price list -- a customer must see the real fee before paying
-- (NKD-015 UI requirement), and checkout can be reached signed out.
-- No sensitive data here (a zone name and a price), same reasoning
-- restaurants.delivery_fee itself was already publicly readable under.
CREATE POLICY "delivery zones public read"
ON public.platform_delivery_zones
FOR SELECT
TO anon, authenticated
USING (true);

-- No direct write policy -- RPC-only mutation, same pattern as every
-- other financially-sensitive table in this schema (orders, payments,
-- user_roles, platform_payout_settings).

-- Admin-only price change. STANDARD step-up (15 min, fallback allowed) --
-- a real financial-impact action (changes what every future order
-- charges), but not "moves money out of the platform" or "changes
-- payment-provider security config" (the two STRICT-tier categories,
-- docs/archive/audits/ADMIN_ACCESS_SECURITY_AUDIT.md), so treated like the other
-- STANDARD-tier financial actions (review_refund_secure/
-- complete_refund_secure) rather than left at Tier 0 or escalated to
-- STRICT.
CREATE OR REPLACE FUNCTION public.update_delivery_zone_fee_secure(_zone_id uuid, _fee_htg numeric)
RETURNS public.platform_delivery_zones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.platform_delivery_zones;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_admin_step_up();

  IF _fee_htg IS NULL OR _fee_htg < 0 THEN
    RAISE EXCEPTION 'Pri livrezon an dwe yon chif pozitif oswa zewo.';
  END IF;

  UPDATE public.platform_delivery_zones
  SET fee_htg = _fee_htg, updated_at = now(), updated_by = v_user
  WHERE id = _zone_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zòn sa a pa jwenn.';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'delivery_zone.fee_updated',
    jsonb_build_object('zone_id', v_row.id, 'new_fee_htg', v_row.fee_htg));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_delivery_zone_fee_secure(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_delivery_zone_fee_secure(uuid, numeric) TO authenticated;

-- create_order_secure: read the platform fee instead of
-- restaurants.delivery_fee. Full body reproduced (CREATE OR REPLACE
-- requires it) -- every line outside the delivery-fee block is
-- byte-identical to the live function (20260814160000_nkd010_stock_decrement.sql),
-- confirmed before writing this, not retyped from memory.
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

  SELECT id, name, status INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restaurant is not available'; END IF;

  -- NKD-015: platform-controlled fee, not restaurant-controlled. No zone
  -- matching yet (confirmed decision) -- always the default zone. NOT
  -- FOUND here would mean the table's seed row and its unique-default
  -- index were both removed, which nothing in this codebase does -- kept
  -- as a real guard anyway, never a silent 0.
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
