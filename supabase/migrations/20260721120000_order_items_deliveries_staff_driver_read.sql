-- The "order_items via order" and "deliveries read" SELECT policies were
-- never updated when restaurant staff and drivers were granted read access
-- to `orders` (20260704180000, 20260709090000, 20260709093000) — they still
-- only cover customer/admin/restaurant owner. Concrete consequence: a
-- restaurant employee who is NOT the owner sees an order on the Kanban
-- board with no items at all (order_items silently returns empty under
-- RLS), and no driver query has ever been able to read order_items even
-- though they can already read the parent order in full.
--
-- Fix: extend both policies the same way "orders read" already was, reusing
-- the existing private.order_visible_to_driver() SECURITY DEFINER helper
-- (created in 20260709093000 specifically to avoid an RLS policy cycle
-- between orders and deliveries) rather than inlining a new correlated
-- subquery.
--
-- order_items: INSERT/UPDATE/DELETE were already revoked from `authenticated`
-- in 20260703200000 (rows are only ever created by create_order_secure), so
-- widening this FOR ALL policy's USING clause only ever widens read access,
-- never write access.
DROP POLICY IF EXISTS "order_items via order" ON public.order_items;
CREATE POLICY "order_items via order" ON public.order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND (
    o.customer_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = o.restaurant_id AND e.user_id = auth.uid())
    OR private.order_visible_to_driver(o.id, o.status)
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.customer_id = auth.uid()));

-- deliveries: FOR SELECT only, no write-access implication either way. No
-- extra driver clause needed — a deliveries row only exists once a driver
-- has already claimed it via claim_delivery_secure, so the existing
-- driver_id clause already covers the whole driver need on this table.
DROP POLICY IF EXISTS "deliveries read" ON public.deliveries;
CREATE POLICY "deliveries read" ON public.deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = deliveries.driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = deliveries.order_id AND (
      o.customer_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = o.restaurant_id AND e.user_id = auth.uid())
    )));
