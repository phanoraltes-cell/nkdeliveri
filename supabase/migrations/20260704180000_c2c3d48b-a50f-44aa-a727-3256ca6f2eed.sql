-- Driver dashboard: self-service claiming, secure status transitions, admin
-- approval RPC, avatars bucket. All business logic (legal transitions,
-- authorization, timestamp stamping) lives server-side.

-- ---------------------------------------------------------------------------
-- 0) Close a self-approval hole matching the one found on restaurants:
-- "drivers_self_update" lets a driver UPDATE their own row with no column
-- restriction — a driver can set their own status to 'approved' directly via
-- the Data API, bypassing admin review. Drivers still need to toggle
-- online/offline themselves and edit their own contact/vehicle info, so this
-- is a trigger-based guard (not a grant revoke): only admins may move a
-- driver into/out of the approval states; the driver may freely flip between
-- 'online' and 'offline' once already approved.
CREATE OR REPLACE FUNCTION private.protect_driver_status_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    IF OLD.status IN ('approved', 'online', 'offline') AND NEW.status IN ('online', 'offline') THEN
      -- allowed: self toggle, once approved
    ELSE
      RAISE EXCEPTION 'Only an admin can change driver approval status' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_driver_status ON public.drivers;
CREATE TRIGGER trg_protect_driver_status
BEFORE UPDATE ON public.drivers
FOR EACH ROW EXECUTE FUNCTION private.protect_driver_status_self_update();

-- ---------------------------------------------------------------------------
-- 1) Admin-only driver approval RPC, replacing the direct table UPDATE the
--    admin dashboard currently uses (now redundant given the trigger above,
--    but keeps the same defense-in-depth pattern used for restaurants).
CREATE OR REPLACE FUNCTION public.update_driver_status_secure(_driver_id uuid, _status public.driver_status)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.drivers;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.drivers SET status = _status WHERE id = _driver_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver not found'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_driver_status_secure(uuid, public.driver_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_status_secure(uuid, public.driver_status) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Claiming: no direct INSERT policy exists for non-admins today (correct
--    — self-service claiming must go through validation), so lock the grant
--    down explicitly and add the RPC that does it properly.
REVOKE INSERT, DELETE ON public.deliveries FROM authenticated;

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

CREATE OR REPLACE FUNCTION public.claim_delivery_secure(_order_id uuid)
RETURNS public.deliveries
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT private.claim_delivery_secure(_order_id);
$$;
REVOKE ALL ON FUNCTION public.claim_delivery_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_delivery_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Delivery progress: "deliveries driver update" already scopes UPDATE to
--    the assigned driver, but has no column/transition restriction — a
--    driver could jump straight to 'delivered' or edit the fee. Guard the
--    legal transitions and keep orders.status in sync automatically,
--    regardless of whether the update comes from the client or an RPC.
--    Free-form fields (driver_lat/lng/heading/location_updated_at,
--    driver_notes) are left untouched by this guard.
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
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Only an admin can reassign a delivery' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_is_admin := private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin');
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

DROP TRIGGER IF EXISTS trg_protect_delivery_status ON public.deliveries;
CREATE TRIGGER trg_protect_delivery_status
BEFORE UPDATE ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION private.protect_delivery_status_transition();

-- ---------------------------------------------------------------------------
-- 3b) "orders read" had no clause letting an online driver see unclaimed,
--     ready-for-pickup orders — there was no way to browse what's available
--     to claim in the first place. Add it.
DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = customer_id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
               WHERE d.order_id = orders.id AND dr.user_id = auth.uid())
    OR (
      orders.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = orders.id)
      AND EXISTS (SELECT 1 FROM public.drivers WHERE user_id = auth.uid() AND status = 'online')
    ));

-- ---------------------------------------------------------------------------
-- 4) Avatars bucket for the customer profile page (public read, owner-scoped
--    write — same pattern as restaurant-assets/user-avatars).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 5) Driver earnings summary — computed server-side from deliveries.fee,
--    never trust a client-side sum. Weekly buckets for a simple bar chart.
CREATE OR REPLACE FUNCTION public.get_driver_earnings_summary(_driver_id uuid, _from date, _to date)
RETURNS TABLE (
  total_deliveries bigint,
  total_earnings numeric,
  week_start date,
  week_earnings numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND user_id = auth.uid())
    OR private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT fee, date_trunc('week', delivered_at)::date AS wk
    FROM public.deliveries
    WHERE driver_id = _driver_id AND status = 'delivered'
      AND delivered_at::date BETWEEN _from AND _to
  )
  SELECT
    (SELECT count(*) FROM d)::bigint,
    (SELECT COALESCE(sum(fee), 0) FROM d),
    wk,
    sum(fee)
  FROM d
  GROUP BY wk
  ORDER BY wk;
END;
$$;
REVOKE ALL ON FUNCTION public.get_driver_earnings_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_earnings_summary(uuid, date, date) TO authenticated;
