-- Security remediation: orders/order_items/payments were writable directly by
-- `authenticated` via the Data API, bypassing create_order_secure's server-side
-- price computation. Nothing in the client code actually inserts/updates these
-- tables directly (order creation goes through create_order_secure, and the
-- only direct write is the admin-only payments status review) — confirmed by
-- grepping src/ before writing this migration. Lock the tables down to the
-- access patterns the app actually uses.

-- orders: client may only read; all writes go through SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
DROP POLICY IF EXISTS "orders insert" ON public.orders;
DROP POLICY IF EXISTS "orders update" ON public.orders;

-- order_items: client may only read (rows are created by create_order_secure).
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated;
-- "order_items via order" (FOR ALL) still governs the remaining SELECT grant.

-- payments: client may still read, and admins may still review/decide
-- (status/review_notes/reviewed_at) via the existing admin-only UPDATE policy.
-- Only INSERT is removed — the initial payments row is created by
-- create_order_secure, never by the client.
REVOKE INSERT, DELETE ON public.payments FROM authenticated;
DROP POLICY IF EXISTS "payments insert" ON public.payments;

-- Secure RPC for order status transitions (restaurant/admin/driver), replacing
-- the direct "orders update" grant that was just removed. Validates legal
-- state transitions and authorization server-side; appends to status_history.
CREATE OR REPLACE FUNCTION private.update_order_status_secure(
  _order_id uuid,
  _new_status public.order_status
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_is_admin boolean;
  v_is_restaurant_owner boolean;
  v_is_assigned_driver boolean;
  v_allowed boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_is_admin := public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin');
  v_is_restaurant_owner := EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id = v_user
  );
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.order_id = v_order.id AND dr.user_id = v_user
  );

  IF NOT (v_is_admin OR v_is_restaurant_owner OR v_is_assigned_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Admins may force any transition (e.g. cancellations, refund bookkeeping).
  IF v_is_admin THEN
    v_allowed := true;
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
  ELSIF v_is_assigned_driver THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('ready','assigned'), ('assigned','picked_up'), ('picked_up','delivered')
    );
  END IF;

  IF NOT v_allowed THEN
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

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status_secure(
  _order_id uuid,
  _new_status public.order_status
)
RETURNS public.orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT private.update_order_status_secure(_order_id, _new_status);
$$;

REVOKE ALL ON FUNCTION public.update_order_status_secure(uuid, public.order_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status_secure(uuid, public.order_status) TO authenticated;
