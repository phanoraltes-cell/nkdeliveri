-- Phase 5, item 2: dispute resolution. Customer reports a problem on an
-- order; restaurant and (if one was assigned) the driver can each respond;
-- admin arbitrates with a final ruling. `dispute_messages` is the append-only
-- journal every reply lands in, so "chaque action doit être journalisée" is
-- satisfied by construction rather than a separate audit table.

CREATE TYPE public.dispute_status AS ENUM ('open', 'resolved');
CREATE TYPE public.dispute_author_role AS ENUM ('customer', 'restaurant', 'driver', 'admin');

CREATE TABLE public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  category text NOT NULL,
  status public.dispute_status NOT NULL DEFAULT 'open',
  resolution text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One live dispute per order at a time; a resolved dispute can be reopened
  -- (fresh problem on the same order) rather than piling up duplicate rows.
  CONSTRAINT disputes_order_unique UNIQUE (order_id)
);

CREATE INDEX disputes_customer_id_idx ON public.disputes(customer_id);
CREATE INDEX disputes_restaurant_id_idx ON public.disputes(restaurant_id);
CREATE INDEX disputes_driver_id_idx ON public.disputes(driver_id);
CREATE INDEX disputes_status_idx ON public.disputes(status);

CREATE TABLE public.dispute_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  author_role public.dispute_author_role NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dispute_messages_dispute_id_idx ON public.dispute_messages(dispute_id, created_at);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disputes read" ON public.disputes FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = disputes.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = disputes.restaurant_id AND e.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = disputes.driver_id AND d.user_id = auth.uid())
  );

CREATE POLICY "dispute_messages read" ON public.dispute_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.disputes dp WHERE dp.id = dispute_messages.dispute_id
        AND (
          dp.customer_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'super_admin')
          OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = dp.restaurant_id AND r.owner_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = dp.restaurant_id AND e.user_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = dp.driver_id AND d.user_id = auth.uid())
        )
    )
  );

REVOKE ALL ON public.disputes FROM PUBLIC, anon;
REVOKE ALL ON public.dispute_messages FROM PUBLIC, anon;
GRANT SELECT ON public.disputes TO authenticated;
GRANT SELECT ON public.dispute_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- Shared helper: who is `auth.uid()` with respect to a given dispute row,
-- and are they allowed to touch it at all. Mirrors the visibility predicate
-- in the RLS policies above so the RPCs and RLS never drift apart.
CREATE OR REPLACE FUNCTION private.dispute_author_role(_dispute public.disputes)
RETURNS public.dispute_author_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _dispute.customer_id = auth.uid() THEN
    RETURN 'customer';
  ELSIF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = _dispute.restaurant_id AND r.owner_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = _dispute.restaurant_id AND e.user_id = auth.uid()) THEN
    RETURN 'restaurant';
  ELSIF EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _dispute.driver_id AND d.user_id = auth.uid()) THEN
    RETURN 'driver';
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Customer opens a dispute — 5 / 30 minutes.
CREATE OR REPLACE FUNCTION public.open_dispute_secure(_order_id uuid, _category text, _description text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_driver_id uuid;
  v_row public.disputes;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _description IS NULL OR length(btrim(_description)) < 5 THEN
    RAISE EXCEPTION 'Tanpri eksplike pwoblèm nan (omwen 5 karaktè)';
  END IF;
  IF _category IS NULL OR length(btrim(_category)) = 0 THEN
    RAISE EXCEPTION 'Chwazi yon kategori';
  END IF;

  IF NOT public.check_rate_limit_secure('open_dispute', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id AND customer_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  SELECT dr.id INTO v_driver_id
  FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
  WHERE de.order_id = _order_id;

  INSERT INTO public.disputes (order_id, customer_id, restaurant_id, driver_id, category)
  VALUES (_order_id, v_user, v_order.restaurant_id, v_driver_id, btrim(_category))
  ON CONFLICT (order_id) DO UPDATE SET
    -- A previous dispute on this order was resolved — a new problem reopens it.
    status = 'open', category = EXCLUDED.category, driver_id = EXCLUDED.driver_id,
    resolution = NULL, resolved_by = NULL, resolved_at = NULL, updated_at = now()
  WHERE disputes.status = 'resolved'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gen deja yon litij louvri pou kòmand sa a';
  END IF;

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (v_row.id, v_user, 'customer', btrim(_description));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.owner_id, 'dispute_opened', 'Nouvo litij sou yon kòmand',
    'Yon kliyan siyale yon pwoblèm sou kòmand ' || v_order.order_number || '.',
    jsonb_build_object('order_id', v_order.id, 'dispute_id', v_row.id)
  FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.open_dispute_secure(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_dispute_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Any party (customer/restaurant/driver/admin) adds a message — 20 / 10 min.
CREATE OR REPLACE FUNCTION public.add_dispute_message_secure(_dispute_id uuid, _message text)
RETURNS public.dispute_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_role public.dispute_author_role;
  v_row public.dispute_messages;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _message IS NULL OR length(btrim(_message)) = 0 THEN
    RAISE EXCEPTION 'Message pa ka vid';
  END IF;

  IF NOT public.check_rate_limit_secure('add_dispute_message', 20, 600) THEN
    RAISE EXCEPTION 'Twòp mesaj. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;

  v_role := private.dispute_author_role(v_dispute);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_dispute.status = 'resolved' THEN
    RAISE EXCEPTION 'Litij sa a deja rezoud';
  END IF;

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (_dispute_id, v_user, v_role, btrim(_message))
  RETURNING * INTO v_row;

  UPDATE public.disputes SET updated_at = now() WHERE id = _dispute_id;

  -- Notify every other party to the dispute (not the author).
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT uid, 'dispute_message', 'Nouvo repons nan yon litij',
    'Gen yon nouvo mesaj nan litij sou kòmand ou.',
    jsonb_build_object('order_id', v_dispute.order_id, 'dispute_id', v_dispute.id)
  FROM (
    SELECT v_dispute.customer_id AS uid
    UNION
    SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_dispute.restaurant_id
    UNION
    SELECT dr.user_id FROM public.drivers dr WHERE dr.id = v_dispute.driver_id
  ) parties
  WHERE uid IS NOT NULL AND uid <> v_user;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_dispute_message_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_dispute_message_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Admin arbitrates.
CREATE OR REPLACE FUNCTION public.resolve_dispute_secure(_dispute_id uuid, _resolution text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _resolution IS NULL OR length(btrim(_resolution)) < 3 THEN
    RAISE EXCEPTION 'Tanpri ekri yon rezolisyon';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.status = 'resolved' THEN
    RAISE EXCEPTION 'Litij sa a deja rezoud';
  END IF;

  UPDATE public.disputes SET
    status = 'resolved', resolution = btrim(_resolution),
    resolved_by = v_user, resolved_at = now(), updated_at = now()
  WHERE id = _dispute_id
  RETURNING * INTO v_dispute;

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (_dispute_id, v_user, 'admin', btrim(_resolution));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT uid, 'dispute_resolved', 'Litij rezoud',
    'Yon administratè rann yon desizyon sou litij la.',
    jsonb_build_object('order_id', v_dispute.order_id, 'dispute_id', v_dispute.id)
  FROM (
    SELECT v_dispute.customer_id AS uid
    UNION
    SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_dispute.restaurant_id
    UNION
    SELECT dr.user_id FROM public.drivers dr WHERE dr.id = v_dispute.driver_id
  ) parties
  WHERE uid IS NOT NULL;

  RETURN v_dispute;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_dispute_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_dispute_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Realtime, same idempotent pattern as 20260714122000_notifications_realtime.sql.
ALTER TABLE public.disputes REPLICA IDENTITY FULL;
ALTER TABLE public.dispute_messages REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'disputes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.disputes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dispute_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispute_messages;
  END IF;
END $$;
