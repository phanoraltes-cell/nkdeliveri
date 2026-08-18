-- NKD-011 — idempotency key on order creation. Règ A5 raised for this
-- scope only (docs/PROTOKOL_FAZ3_A_FAZ11.md). Fixes the "connection drops
-- after the request is sent but before the response arrives" scenario
-- (Senaryo A): customer retries, create_order_secure runs a second time,
-- producing a duplicate order + payment + double stock decrement + double
-- commission (compounds NKD-010 and NKD-015, both already live).
--
-- Structure decision (owner-confirmed, KANPE EPI MANDE round): a column on
-- orders + a unique index, not a separate ledger table. Rationale: the
-- existing precedent for a separate table (public.moncash_webhook_events,
-- UNIQUE(event_id), insert-first/catch-23505) exists specifically because
-- a webhook delivery spans multiple independent steps *outside* a single
-- DB transaction. create_order_secure's entire body is already one
-- transaction/one function call -- the closer, already-established
-- precedent for that shape is commission_ledger's partial unique indexes +
-- `INSERT ... ON CONFLICT ... DO NOTHING RETURNING id` idiom
-- (commission_engine.sql), used throughout this project for exactly this
-- kind of single-transaction idempotence. Adapted here to `DO UPDATE`
-- (a genuine no-op) instead of `DO NOTHING`, because NKD-011 needs the
-- *existing* order_id back on a duplicate call, not silence -- `DO
-- NOTHING` returns no row on conflict, `DO UPDATE ... RETURNING` always
-- does, and is still a single atomic statement (safe under two
-- simultaneous requests with the same key -- one blocks on the other's
-- row-level lock, then both return the same winning id, never two rows).
--
-- Null/empty key: rejected unconditionally (owner-confirmed) -- checkout.tsx
-- is the only real caller in the whole codebase (verified, Etap 0), so
-- there is no legitimate caller that should ever omit it.
--
-- Failed-order case (e.g. insufficient stock): no cleanup needed. A
-- RAISE EXCEPTION anywhere in this function aborts the whole transaction,
-- so the orders row (and its idempotency_key) that was inserted earlier
-- in the same call never actually commits -- the key is automatically
-- free to reuse on the customer's next attempt, for free, from
-- transaction atomicity alone.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid);
--   DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid);
--   -- Re-apply the immediately-prior CREATE (OR REPLACE) of both
--   -- (20260723090000_notifications_engine_and_gps_sharing.sql:336-476 for
--   -- the 7-arg private+public pair, 20260817120000_nkd016_delivery_failed.sql
--   -- §2 for private's Kreyòl-message body) verbatim, in that order.
--   DROP INDEX IF EXISTS orders_idempotency_key_uniq;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS idempotency_key;
--
-- Wrapped in BEGIN...COMMIT: run raw in SQL Editor (autocommit per
-- statement) this file's own DROP FUNCTION + CREATE FUNCTION pair would
-- otherwise leave a real window, between the two statements, where
-- create_order_secure does not exist at all -- any checkout request
-- landing in that gap gets a hard "function not found" instead of a
-- normal order. Every statement below (ALTER TABLE, CREATE INDEX, DROP/
-- CREATE FUNCTION, REVOKE, GRANT) is ordinary transactional DDL in
-- Postgres (none of them is CONCURRENTLY or otherwise non-transactional),
-- so wrapping is free -- and it also means a failure partway through
-- rolls back cleanly instead of leaving the schema half-migrated.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema. Nullable -- Postgres never treats two NULLs as conflicting in
--    a unique index, so historical rows (all NULL) need no backfill and no
--    partial-index clause.
ALTER TABLE public.orders ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX orders_idempotency_key_uniq ON public.orders (idempotency_key);

-- ---------------------------------------------------------------------------
-- 2) private.create_order_secure -- signature grows a new required-in-body
--    (defaulted-in-declaration, per the same trailing-param convention
--    _wants_location_sharing already uses) `_idempotency_key uuid` param.
--    A trailing DEFAULT keeps this a pure append (no reordering of the 7
--    existing params) -- Supabase RPC calls are always named-JSON, never
--    positional, so this is purely a declaration-syntax convenience, not a
--    real optionality: the body rejects NULL immediately below.
--    DROP first -- an added parameter is a real signature change
--    (check-migration-hazards.mjs would otherwise flag/silently create a
--    second overload), same reasoning as the DROP already recorded at
--    20260723090000_notifications_engine_and_gps_sharing.sql:336 when this
--    function last grew a parameter.
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean);
CREATE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_was_inserted boolean;
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

  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
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

  -- NKD-011: single atomic upsert-by-key. If this key already produced an
  -- order (customer retried after a lost connection, not a real double
  -- decision), (xmax = 0) is false and we return that existing order_id
  -- immediately below -- no second item loop, no second stock decrement,
  -- no second payments row. Under two simultaneous requests with the same
  -- key, Postgres's row-level lock on the conflicting unique-index entry
  -- serializes them: the loser blocks until the winner commits, then both
  -- branches of this statement return the same single winning row --
  -- never a `SELECT`-after-`INSERT` race.
  INSERT INTO public.orders (
    order_number, customer_id, restaurant_id, delivery_address, delivery_notes, contact_phone,
    subtotal, delivery_fee, service_fee, total, currency, status, wants_location_sharing, idempotency_key
  ) VALUES (
    v_order_number, v_user, _restaurant_id, _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending', COALESCE(_wants_location_sharing, false), _idempotency_key
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = orders.updated_at
  RETURNING id, (xmax = 0) INTO v_order_id, v_was_inserted;

  IF NOT v_was_inserted THEN
    RETURN v_order_id;
  END IF;

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
-- 3) public.create_order_secure -- thin SQL wrapper, same append-only
--    signature growth, same DROP-first requirement as §2.
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean);
CREATE FUNCTION public.create_order_secure(
  _restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text,
  _delivery_notes text, _method public.payment_method, _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method,
    _wants_location_sharing, _idempotency_key
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid) TO authenticated;

COMMIT;
