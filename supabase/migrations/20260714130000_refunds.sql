-- Phase 5, item 1: refund system. `payment_status` and `order_status` both
-- already had a 'refunded' value, but nothing in the app ever set it — no
-- request/review workflow existed. This adds a dedicated `refunds` table
-- (auditable, RPC-only mutation like payments/orders) with a 4-state
-- lifecycle: requested -> approved|rejected -> completed (money actually
-- moved). `payments.status`/`orders.status` only flip to 'refunded' at the
-- `completed` step, once the refund has actually been processed, not at
-- approval time.

CREATE TYPE public.refund_status AS ENUM ('requested', 'approved', 'rejected', 'completed');

CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  reason text NOT NULL,
  status public.refund_status NOT NULL DEFAULT 'requested',
  admin_notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  completed_at timestamptz,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One live (non-rejected) refund request per order at a time.
  CONSTRAINT refunds_order_unique_active UNIQUE (order_id)
);

CREATE INDEX refunds_customer_id_idx ON public.refunds(customer_id);
CREATE INDEX refunds_restaurant_id_idx ON public.refunds(restaurant_id);
CREATE INDEX refunds_status_idx ON public.refunds(status);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- Read-only via RLS; every write goes through a SECURITY DEFINER RPC below
-- (same posture as payments/orders — see 20260703200000 dropping the
-- payments insert policy for the precedent).
CREATE POLICY "refunds read" ON public.refunds FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.restaurants r WHERE r.id = refunds.restaurant_id AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_employees e
      WHERE e.restaurant_id = refunds.restaurant_id AND e.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.refunds FROM PUBLIC, anon;
GRANT SELECT ON public.refunds TO authenticated;

-- ---------------------------------------------------------------------------
-- 1) Customer requests a refund — 5 requests / 30 minutes.
CREATE OR REPLACE FUNCTION public.request_refund_secure(_order_id uuid, _reason text)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
  v_row public.refunds;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Tanpri eksplike rezon an (omwen 5 karaktè)';
  END IF;

  IF NOT public.check_rate_limit_secure('request_refund', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id AND customer_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  IF v_order.status NOT IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Ou ka mande yon ranbousman sèlman apre kòmand la livre oswa anile';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE order_id = _order_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'Pa gen peman apwouve pou kòmand sa a';
  END IF;

  IF EXISTS (SELECT 1 FROM public.refunds WHERE order_id = _order_id AND status <> 'rejected') THEN
    RAISE EXCEPTION 'Gen deja yon demann ranbousman pou kòmand sa a';
  END IF;

  INSERT INTO public.refunds (order_id, payment_id, customer_id, restaurant_id, amount, reason, status_history)
  VALUES (
    _order_id, v_payment.id, v_user, v_order.restaurant_id, v_payment.amount, btrim(_reason),
    jsonb_build_array(jsonb_build_object('to', 'requested', 'by', v_user, 'at', now()))
  )
  ON CONFLICT (order_id) DO UPDATE SET
    -- A previous request on this order was rejected — allow a fresh one.
    status = 'requested', reason = EXCLUDED.reason, amount = EXCLUDED.amount,
    payment_id = EXCLUDED.payment_id, admin_notes = NULL, reviewed_by = NULL, reviewed_at = NULL,
    completed_at = NULL, updated_at = now(),
    status_history = refunds.status_history || jsonb_build_object('to', 'requested', 'by', v_user, 'at', now())
  WHERE refunds.status = 'rejected'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gen deja yon demann ranbousman pou kòmand sa a';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.owner_id, 'refund_requested', 'Nouvo demann ranbousman',
    'Yon kliyan mande yon ranbousman pou kòmand ' || v_order.order_number || '.',
    jsonb_build_object('order_id', v_order.id, 'refund_id', v_row.id)
  FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.request_refund_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_refund_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Admin approves/rejects the request.
CREATE OR REPLACE FUNCTION public.review_refund_secure(
  _refund_id uuid,
  _decision public.refund_status,
  _admin_notes text
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'This refund has already been reviewed';
  END IF;

  UPDATE public.refunds SET
    status = _decision,
    admin_notes = NULLIF(btrim(_admin_notes), ''),
    reviewed_by = v_user,
    reviewed_at = now(),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', _decision, 'by', v_user, 'at', now())
  WHERE id = _refund_id
  RETURNING * INTO v_row;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id,
    'refund_' || _decision,
    CASE WHEN _decision = 'approved' THEN 'Ranbousman apwouve' ELSE 'Ranbousman rejte' END,
    CASE WHEN _decision = 'approved'
      THEN 'Demann ranbousman ou apwouve. Lajan an ap trete.'
      ELSE 'Demann ranbousman ou rejte.' || COALESCE(' Rezon: ' || v_row.admin_notes, '')
    END,
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.review_refund_secure(uuid, public.refund_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_refund_secure(uuid, public.refund_status, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Admin marks an approved refund as completed (money actually sent back)
--    — this is the one moment payments/orders flip to 'refunded'.
CREATE OR REPLACE FUNCTION public.complete_refund_secure(_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.refunds;
  v_order_status public.order_status;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved refund can be marked completed';
  END IF;

  UPDATE public.refunds SET
    status = 'completed',
    completed_at = now(),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'completed', 'by', v_user, 'at', now())
  WHERE id = _refund_id
  RETURNING * INTO v_row;

  UPDATE public.payments SET status = 'refunded' WHERE id = v_row.payment_id;

  SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id FOR UPDATE;
  UPDATE public.orders SET
    status = 'refunded',
    status_history = status_history || jsonb_build_object(
      'from', v_order_status, 'to', 'refunded', 'by', v_user, 'at', now()
    ),
    updated_at = now()
  WHERE id = v_row.order_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.customer_id, 'refund_completed', 'Ranbousman trete',
    'Lajan pou kòmand ou an ranbouse.',
    jsonb_build_object('order_id', v_row.order_id, 'refund_id', v_row.id)
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_refund_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_refund_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Realtime, same idempotent pattern as 20260714122000_notifications_realtime.sql.
ALTER TABLE public.refunds REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'refunds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.refunds;
  END IF;
END $$;
