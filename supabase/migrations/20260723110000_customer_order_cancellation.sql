-- Phase 3 of the v7 plan: customer-initiated cancellation, before the
-- restaurant starts preparing. Extends update_order_status_secure (same
-- signature, CREATE OR REPLACE in place) rather than a new RPC, so the
-- restaurant Kanban (already reading orders.status live via Realtime)
-- reflects a customer cancellation for free, and the existing
-- status_history/notification plumbing is reused rather than duplicated.
--
-- "Avant que le restaurant commence la préparation" = orders.status IN
-- ('pending','confirmed') -- confirmed by reading order-kanban-board.tsx's
-- own CANCELLABLE_FROM set: the "Ap prepare" column IS status='preparing',
-- so anything strictly before it is exactly {pending, confirmed}.
--
-- This can never reach 'delivered' or the delivered->refunded reversal
-- path, so trg_generate_commission_on_delivery/trg_reverse_commission_on_refund
-- (which only fire on those two exact transitions) are structurally
-- unreachable from here -- nothing to special-case in either trigger.
--
-- Refunds: request_refund_secure already accepts orders.status='cancelled'
-- as a valid input (verified by reading it directly) -- no new refund
-- code needed, cancelling just makes the existing RefundSection/RPC
-- reachable if the order was already paid.
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
    -- Checked before v_is_restaurant_owner/v_is_assigned_driver on
    -- purpose: those roles can never also be the customer on their own
    -- order, so there's no ordering conflict, but a customer's own cancel
    -- request must never fall through to a broader role's transition
    -- table by accident.
    IF NOT public.check_rate_limit_secure('cancel_order_customer', 5, 3600) THEN
      RAISE EXCEPTION 'Twòp demann anilasyon. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
    END IF;
    v_allowed := _new_status = 'cancelled' AND v_order.status IN ('pending', 'confirmed');
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
    IF v_allowed AND v_order.status = 'pending' AND _new_status = 'confirmed' AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.order_id = v_order.id AND p.method IN ('moncash', 'natcash') AND p.status <> 'paid'
    ) THEN
      RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.' USING ERRCODE = '42501';
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

  -- GPS-sharing auto-revocation gap found during the pre-deployment audit:
  -- private.protect_delivery_status_transition() already wipes
  -- customer_delivery_locations when *deliveries.status* reaches a
  -- terminal state, but this function only ever writes *orders.status*
  -- and never touches deliveries -- an admin force-cancelling an order
  -- that already has an active delivery (v_is_admin allows 'cancelled'
  -- from any status) would leave the delivery row, and therefore the
  -- customer's last shared position, untouched and still visible to the
  -- driver/admin. Cover every path through this function (not just the
  -- customer's) so "jamais visible après la fin de la livraison" holds
  -- regardless of which role ended it or how.
  IF _new_status IN ('cancelled', 'delivered') THEN
    DELETE FROM public.customer_delivery_locations
    WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE order_id = v_order.id);
  END IF;

  IF v_is_customer AND _new_status = 'cancelled' THEN
    PERFORM private.log_audit_event(v_user, 'customer', 'order.cancelled_by_customer',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));
    -- The customer already knows they just cancelled their own order --
    -- notify the restaurant and admin team instead of re-notifying them.
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
$$;
-- Same signature as the live version -- no DROP/GRANT changes needed.
