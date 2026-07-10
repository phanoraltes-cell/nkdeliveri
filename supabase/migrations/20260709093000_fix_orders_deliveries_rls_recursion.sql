-- Critical, previously-undiscovered bug (found while SQL-testing the staff
-- feature, unrelated to it): "orders read" RLS references public.deliveries
-- (for the assigned-driver / available-for-pickup clauses), and "deliveries
-- read" RLS references public.orders right back (for the customer/owner
-- visibility clauses). Postgres detects this as a policy cycle and refuses
-- to plan the query at all:
--   ERROR 42P17: infinite recursion detected in policy for relation "orders"
-- Reproduced live: even the restaurant OWNER's own SELECT on their orders —
-- exactly what dashboard.restaurant.orders.tsx ("Kòmand") runs on every
-- load — throws this. This has nothing to do with the driver_id/customer_id
-- branches actually matching; Postgres's policy expander hits the cycle
-- while planning, regardless of which OR branch would end up true for a
-- given row.
--
-- Fix: route the driver-related clauses in "orders read" through a
-- SECURITY DEFINER function instead of an inline correlated subquery. A
-- SECURITY DEFINER function call is opaque to the policy-cycle detector —
-- it's evaluated as a plain function call, not inlined as a subquery against
-- deliveries' own RLS-protected policy — so this breaks the cycle without
-- touching "deliveries read" at all.
CREATE OR REPLACE FUNCTION private.order_visible_to_driver(_order_id uuid, _status public.order_status)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
      WHERE d.order_id = _order_id AND dr.user_id = auth.uid()
    )
    OR (
      _status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = _order_id)
      AND EXISTS (SELECT 1 FROM public.drivers WHERE user_id = auth.uid() AND status = 'online')
    );
$$;

DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = customer_id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = orders.restaurant_id AND e.user_id = auth.uid())
    OR private.order_visible_to_driver(orders.id, orders.status));
