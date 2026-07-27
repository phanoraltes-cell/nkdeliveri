-- Phase 2 of the v7 plan: order-scoped chat between customer, assigned
-- driver, and admin. The restaurant deliberately does not participate --
-- every helper/policy below omits the restaurant-owner/staff branch that
-- the disputes system (its closest analog) includes. Unlike disputes,
-- there's no separate "thread" header row: a chat's open/read-only state
-- is derived directly from orders.status, nothing new to keep in sync.

CREATE TABLE public.order_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  author_role text NOT NULL CHECK (author_role IN ('customer', 'driver', 'admin')),
  message text,
  image_url text,
  lat numeric,
  lng numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_chat_messages_has_content CHECK (
    message IS NOT NULL OR image_url IS NOT NULL OR (lat IS NOT NULL AND lng IS NOT NULL)
  )
);
CREATE INDEX order_chat_messages_order_id_idx ON public.order_chat_messages(order_id, created_at);

CREATE TABLE public.order_chat_reads (
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, user_id)
);

ALTER TABLE public.order_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_chat_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_chat_messages REPLICA IDENTITY FULL;

REVOKE ALL ON public.order_chat_messages FROM PUBLIC, anon;
REVOKE ALL ON public.order_chat_reads FROM PUBLIC, anon;
GRANT SELECT ON public.order_chat_messages TO authenticated;
GRANT SELECT ON public.order_chat_reads TO authenticated;

-- Same "who is auth.uid() to this order" resolution used by both the RLS
-- policies and the RPCs below, mirroring private.dispute_author_role --
-- with no restaurant branch, the one deliberate difference from that
-- pattern (the restaurant does not participate in this chat).
CREATE OR REPLACE FUNCTION private.order_chat_author_role(_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  ELSIF v_customer_id = auth.uid() THEN
    RETURN 'customer';
  ELSIF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN 'admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
    WHERE de.order_id = _order_id AND dr.user_id = auth.uid()
  ) THEN
    RETURN 'driver';
  ELSE
    RETURN NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.order_chat_author_role(uuid) FROM PUBLIC, anon, authenticated;

CREATE POLICY "order_chat_messages read" ON public.order_chat_messages FOR SELECT TO authenticated
  USING (private.order_chat_author_role(order_id) IS NOT NULL);

CREATE POLICY "order_chat_reads own" ON public.order_chat_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No direct write grant on either table -- both RPCs below are the only
-- write path, same convention as dispute_messages.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_chat_messages;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Storage: images/GPS pins attached to a chat message. Same conventions as
-- dispute-attachments (private bucket, folder keyed by the parent id, one
-- SECURITY DEFINER visibility helper reused for upload/read policies).
-- Same MIME allowlist as every other image bucket in this project
-- (heic/heif included -- the default camera format on iPhones, see
-- src/lib/file-validation.ts's own comment on why).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('order-chat-attachments', 'order-chat-attachments', false, 8 * 1024 * 1024,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.order_chat_folder_visible(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.order_chat_author_role(_order_id) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.order_chat_folder_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.order_chat_folder_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "order chat attachments upload by party" ON storage.objects;
CREATE POLICY "order chat attachments upload by party"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'order-chat-attachments'
  AND private.order_chat_folder_visible(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "order chat attachments read by party" ON storage.objects;
CREATE POLICY "order chat attachments read by party"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'order-chat-attachments'
  AND private.order_chat_folder_visible(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "order chat attachments delete by admin" ON storage.objects;
CREATE POLICY "order chat attachments delete by admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'order-chat-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
);

-- ---------------------------------------------------------------------------
-- Send a message (text and/or image and/or a one-off GPS pin). Rejects
-- outside the statuses the order is explicitly "open" for -- enforced
-- here, not just hidden client-side, same defensive pattern as
-- add_dispute_message_secure rejecting sends on a resolved dispute.
CREATE OR REPLACE FUNCTION public.send_order_chat_message_secure(
  _order_id uuid, _message text DEFAULT NULL, _image_url text DEFAULT NULL,
  _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL
)
RETURNS public.order_chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_order record;
  v_row public.order_chat_messages;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _message IS NULL AND _image_url IS NULL AND (_lat IS NULL OR _lng IS NULL) THEN
    RAISE EXCEPTION 'Mesaj la vid';
  END IF;

  IF NOT public.check_rate_limit_secure('send_order_chat_message', 30, 600) THEN
    RAISE EXCEPTION 'Twòp mesaj. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT id, status, customer_id, restaurant_id INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_role := private.order_chat_author_role(_order_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- orders.status only ever takes these 9 values (pending, confirmed,
  -- preparing, ready, assigned, picked_up, delivered, cancelled, refunded)
  -- -- en_route_pickup/en_route_dropoff are deliveries.status-only
  -- sub-states never mirrored onto orders.status (confirmed by reading
  -- private.protect_delivery_status_transition(), which only writes
  -- orders.status for the picked_up/delivered transitions), so they must
  -- not appear in this comparison or a valid IN-transit order would
  -- error out here instead of correctly matching "ouvert".
  IF v_order.status NOT IN ('confirmed', 'preparing', 'ready', 'assigned', 'picked_up') THEN
    RAISE EXCEPTION 'Chat la fèmen pou kòmand sa a';
  END IF;

  INSERT INTO public.order_chat_messages (order_id, author_id, author_role, message, image_url, lat, lng)
  VALUES (_order_id, v_user, v_role, NULLIF(btrim(_message), ''), _image_url, _lat, _lng)
  RETURNING * INTO v_row;

  -- Fan out to every other party (customer/driver/admin, never
  -- restaurant) via the generic engine built in the previous migration.
  PERFORM private.notify_secure(
    ARRAY(
      SELECT DISTINCT uid FROM (
        SELECT v_order.customer_id AS uid
        UNION
        SELECT dr.user_id FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
          WHERE de.order_id = _order_id
      ) parties
      WHERE uid IS NOT NULL AND uid <> v_user
    ),
    'order_chat_message', 'delivery', 'Nouvo mesaj',
    'Gen yon nouvo mesaj nan chat livrezon an.',
    jsonb_build_object('order_id', _order_id)
  );
  -- Admins aren't enumerable as a small fixed list the way customer/driver
  -- are -- notify every admin/super_admin separately so a new message
  -- always reaches the admin team, not just the two delivery parties.
  PERFORM private.notify_secure(
    ARRAY(
      SELECT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin', 'super_admin') AND ur.user_id <> v_user
    ),
    'order_chat_message', 'delivery', 'Nouvo mesaj nan yon chat livrezon',
    'Gen yon nouvo mesaj nan chat kòmand ' || COALESCE((SELECT order_number FROM public.orders WHERE id = _order_id), '') || '.',
    jsonb_build_object('order_id', _order_id)
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.send_order_chat_message_secure(uuid, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_order_chat_message_secure(uuid, text, text, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_order_chat_read_secure(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF private.order_chat_author_role(_order_id) IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.order_chat_reads (order_id, user_id, last_read_at)
  VALUES (_order_id, v_user, now())
  ON CONFLICT (order_id, user_id) DO UPDATE SET last_read_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.mark_order_chat_read_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_chat_read_secure(uuid) TO authenticated;
