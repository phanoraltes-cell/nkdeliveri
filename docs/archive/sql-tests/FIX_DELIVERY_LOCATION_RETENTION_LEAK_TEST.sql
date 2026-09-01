-- Tès pou 20260821090000_fix_delivery_location_retention_leak.sql.
-- REHEARSE-STYLE (BEGIN...ROLLBACK) — migrasyon an poko aplike an
-- pwodiksyon. Fichye sa a OTO-PÒTAN: li kreye tab/fonksyon nouvo yo TOUT
-- ANDEDAN menm transaksyon BEGIN...ROLLBACK la — ou ka kouri l jan li ye a,
-- san ou pa aplike migrasyon an anvan. ROLLBACK anile tout bagay, menm si
-- tès yo tout PASS.
-- Règ A10: rezilta ekri nan yon tab tanporè + SELECT anvan ROLLBACK.

BEGIN;

-- ===========================================================================
-- Kò migrasyon an (verbatim, san BEGIN/COMMIT/schema_migrations li).
CREATE TABLE public.delivery_proof (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE REFERENCES public.deliveries(id) ON DELETE CASCADE,
  final_driver_lat numeric,
  final_driver_lng numeric,
  final_location_at timestamptz,
  final_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_proof ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_proof FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_proof TO authenticated;
GRANT ALL ON public.delivery_proof TO service_role;
CREATE POLICY "delivery_proof admin read" ON public.delivery_proof FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

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

      IF NEW.driver_lat IS NOT NULL OR NEW.driver_lng IS NOT NULL THEN
        INSERT INTO public.delivery_proof (delivery_id, final_driver_lat, final_driver_lng, final_location_at, final_status)
        VALUES (NEW.id, NEW.driver_lat, NEW.driver_lng, NEW.location_updated_at, NEW.status::text)
        ON CONFLICT (delivery_id) DO UPDATE SET
          final_driver_lat = EXCLUDED.final_driver_lat,
          final_driver_lng = EXCLUDED.final_driver_lng,
          final_location_at = EXCLUDED.final_location_at,
          final_status = EXCLUDED.final_status;
      END IF;

      NEW.driver_lat := NULL;
      NEW.driver_lng := NULL;
      NEW.driver_heading := NULL;
      NEW.location_updated_at := NULL;
    END IF;

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

-- ===========================================================================
-- Tès yo.
CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_driver_user uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_driver_id uuid;
  v_order1 uuid; v_order2 uuid; v_order3 uuid;
  v_delivery1 uuid; v_delivery2 uuid; v_delivery3 uuid;
  v_row record;
  v_proof record;
  v_caught boolean;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'leak-admin@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'leak-customer@example.com', 'x', now(), '{}', '{}'),
    (v_driver_user, 'leak-driver@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'leak-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'leak-test-resto', 'Leak Test Resto', 'approved', 0);
  INSERT INTO public.drivers (id, user_id, status)
  VALUES (gen_random_uuid(), v_driver_user, 'online')
  RETURNING id INTO v_driver_id;

  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total)
  VALUES (gen_random_uuid(), v_customer, v_restaurant, 'Test address 1', '50900000000', 100, 100)
  RETURNING id INTO v_order1;
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total)
  VALUES (gen_random_uuid(), v_customer, v_restaurant, 'Test address 2', '50900000000', 100, 100)
  RETURNING id INTO v_order2;
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, subtotal, total)
  VALUES (gen_random_uuid(), v_customer, v_restaurant, 'Test address 3', '50900000000', 100, 100)
  RETURNING id INTO v_order3;

  INSERT INTO public.deliveries (id, order_id, driver_id, status, fee)
  VALUES (gen_random_uuid(), v_order1, v_driver_id, 'assigned', 100) RETURNING id INTO v_delivery1;
  INSERT INTO public.deliveries (id, order_id, driver_id, status, fee)
  VALUES (gen_random_uuid(), v_order2, v_driver_id, 'assigned', 100) RETURNING id INTO v_delivery2;
  INSERT INTO public.deliveries (id, order_id, driver_id, status, fee)
  VALUES (gen_random_uuid(), v_order3, v_driver_id, 'assigned', 100) RETURNING id INTO v_delivery3;

  -- T1 — driver shares live GPS, non-terminal transition -> location
  -- UNCHANGED, no proof row created yet.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET driver_lat = 19.451, driver_lng = -72.683, driver_heading = 90, location_updated_at = now()
    WHERE id = v_delivery1;
  UPDATE public.deliveries SET status = 'picked_up' WHERE id = v_delivery1;
  RESET ROLE;
  SELECT driver_lat, driver_lng INTO v_row FROM public.deliveries WHERE id = v_delivery1;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN v_row.driver_lat = 19.451 AND v_row.driver_lng = -72.683
           AND NOT EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery1)
         THEN 'PASS' ELSE 'FAIL' END,
    'apre picked_up (pa terminal): lat=' || COALESCE(v_row.driver_lat::text, 'NULL') || ', proof egziste=' ||
      EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery1)::text);

  -- T2 — 'delivered' (terminal) -> live location nulled, BUT a proof row
  -- now exists with the captured final position (the actual fix).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'delivered' WHERE id = v_delivery1;
  RESET ROLE;
  SELECT driver_lat, driver_lng, driver_heading, location_updated_at INTO v_row
    FROM public.deliveries WHERE id = v_delivery1;
  SELECT final_driver_lat, final_driver_lng, final_status INTO v_proof
    FROM public.delivery_proof WHERE delivery_id = v_delivery1;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN v_row.driver_lat IS NULL AND v_row.driver_lng IS NULL
           AND v_row.driver_heading IS NULL AND v_row.location_updated_at IS NULL
           AND v_proof.final_driver_lat = 19.451 AND v_proof.final_driver_lng = -72.683
           AND v_proof.final_status = 'delivered'
         THEN 'PASS' ELSE 'FAIL' END,
    'live lat=' || COALESCE(v_row.driver_lat::text, 'NULL') || ', proof lat=' || COALESCE(v_proof.final_driver_lat::text, 'NULL'));

  -- T3 — proof row is NOT readable by the customer (admin-only RLS).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery1) THEN 'PASS' ELSE 'FAIL' END,
    'kliyan pa ka li delivery_proof');
  RESET ROLE;

  -- T4 — proof row IS readable by an admin.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN EXISTS (SELECT 1 FROM public.delivery_proof WHERE delivery_id = v_delivery1) THEN 'PASS' ELSE 'FAIL' END,
    'admin ka li delivery_proof');
  RESET ROLE;

  -- T5 — delivery_failed (terminal) also captures proof + nulls live location.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET driver_lat = 19.5, driver_lng = -72.7, driver_heading = 45, location_updated_at = now()
    WHERE id = v_delivery2;
  UPDATE public.deliveries SET status = 'picked_up' WHERE id = v_delivery2;
  UPDATE public.deliveries SET status = 'delivery_failed' WHERE id = v_delivery2;
  RESET ROLE;
  SELECT driver_lat INTO v_row FROM public.deliveries WHERE id = v_delivery2;
  SELECT final_driver_lat, final_status INTO v_proof FROM public.delivery_proof WHERE delivery_id = v_delivery2;
  INSERT INTO test_results VALUES ('T5',
    CASE WHEN v_row.driver_lat IS NULL AND v_proof.final_driver_lat = 19.5 AND v_proof.final_status = 'delivery_failed'
         THEN 'PASS' ELSE 'FAIL' END,
    'delivery_failed: live=' || COALESCE(v_row.driver_lat::text,'NULL') || ' proof=' || COALESCE(v_proof.final_driver_lat::text,'NULL'));

  -- T6 — admin cancels delivery3 directly -> proof captured, live nulled.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET driver_lat = 19.6, driver_lng = -72.8 WHERE id = v_delivery3;
  UPDATE public.deliveries SET status = 'cancelled' WHERE id = v_delivery3;
  RESET ROLE;
  SELECT driver_lat INTO v_row FROM public.deliveries WHERE id = v_delivery3;
  SELECT final_driver_lat, final_status INTO v_proof FROM public.delivery_proof WHERE delivery_id = v_delivery3;
  INSERT INTO test_results VALUES ('T6',
    CASE WHEN v_row.driver_lat IS NULL AND v_proof.final_driver_lat = 19.6 AND v_proof.final_status = 'cancelled'
         THEN 'PASS' ELSE 'FAIL' END,
    'cancelled: live=' || COALESCE(v_row.driver_lat::text,'NULL') || ' proof=' || COALESCE(v_proof.final_driver_lat::text,'NULL'));

  -- T7 — regression: customer_delivery_locations DELETE still fires.
  INSERT INTO public.customer_delivery_locations (delivery_id, lat, lng)
  VALUES (v_delivery1, 19.4, -72.6)
  ON CONFLICT (delivery_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.deliveries SET status = 'cancelled' WHERE id = v_delivery1; -- delivered -> cancelled, admin bypasses whitelist
  RESET ROLE;
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.customer_delivery_locations WHERE delivery_id = v_delivery1)
         THEN 'PASS' ELSE 'FAIL' END,
    'customer_delivery_locations toujou efase sou tranzisyon terminal');

  -- T8 — regression: illegal transition for a non-admin still rejected.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_driver_user, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    UPDATE public.deliveries SET status = 'en_route_dropoff' WHERE id = v_delivery2; -- delivery2 is delivery_failed, terminal
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T8', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'tranzisyon ilegal toujou rejte: ' || v_caught::text);

  -- T9 — ON CONFLICT upsert: delivery1 was already captured once
  -- ('delivered' in T2), then transitioned again to 'cancelled' in T7 —
  -- confirms the proof row was UPDATED to the latest snapshot, not
  -- duplicated (delivery_id UNIQUE + ON CONFLICT DO UPDATE).
  SELECT final_status INTO v_proof FROM public.delivery_proof WHERE delivery_id = v_delivery1;
  INSERT INTO test_results VALUES ('T9',
    CASE WHEN v_proof.final_status = 'cancelled'
           AND (SELECT count(*) FROM public.delivery_proof WHERE delivery_id = v_delivery1) = 1
         THEN 'PASS' ELSE 'FAIL' END,
    'dènye final_status=' || COALESCE(v_proof.final_status, 'NULL') || ', yon sèl ranje pou delivery1');
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
