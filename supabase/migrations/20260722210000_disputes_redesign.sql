-- Phase 5 of the admin evolution plan: disputes redesign. Audit of the
-- Phase-4-era system (20260714131500_disputes.sql) found real gaps: a
-- binary open/resolved status with no "under review" or "action needed"
-- middle ground and no distinct "rejected"/"escalated" outcome, a free-text
-- `category` mixing payment/delivery/restaurant/driver motives with no
-- structure, no internal-only admin notes (every message is visible to
-- every party, including mid-investigation), no attachments, and no audit
-- trail of status changes themselves (`dispute_messages` was the closest
-- thing to one). This migration is purely additive/extending — the
-- existing open/resolve/message RPCs, their rate limits, and the
-- `UNIQUE(order_id)` one-active-dispute-at-a-time rule are all preserved.

-- ---------------------------------------------------------------------------
-- 1) `status`: enum -> text + CHECK. The enum only ever had 2 values and
-- nothing outside this table returns `public.dispute_status` directly (the
-- RPCs return the `public.disputes` row type, which follows the column's
-- new type automatically) -- converting avoids ALTER TYPE ADD VALUE's
-- same-transaction restrictions entirely and matches this table's own
-- `category` column, already free text. The old enum type is left in place
-- (unused, harmless) rather than dropped, since dropping it would require
-- confirming zero references first for no real benefit.
ALTER TABLE public.disputes ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.disputes ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check
  CHECK (status IN ('open', 'in_review', 'action_required', 'resolved', 'rejected', 'escalated'));
ALTER TABLE public.disputes ALTER COLUMN status SET DEFAULT 'open';

-- 2) Structured category group. `category` (free text) is kept as-is for
-- the specific sub-reason already collected today -- category_group adds
-- the requested grouping without losing any existing data.
ALTER TABLE public.disputes ADD COLUMN category_group text NOT NULL DEFAULT 'delivery'
  CHECK (category_group IN ('payment', 'delivery', 'restaurant', 'driver'));

UPDATE public.disputes SET category_group = CASE
  WHEN category ILIKE '%peman%' OR category ILIKE '%kach%' THEN 'payment'
  WHEN category ILIKE '%manje%' OR category ILIKE '%kalite%' THEN 'restaurant'
  WHEN category ILIKE '%livrè%' OR category ILIKE '%konpòtman%' THEN 'driver'
  ELSE 'delivery'
END;

ALTER TABLE public.disputes ADD COLUMN assigned_to uuid REFERENCES auth.users(id);
-- Same jsonb-array-of-events pattern already proven by `refunds.status_history`.
ALTER TABLE public.disputes ADD COLUMN status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX disputes_category_group_idx ON public.disputes(category_group);
CREATE INDEX disputes_assigned_to_idx ON public.disputes(assigned_to);

-- 3) Internal admin notes + optional attachment on messages.
ALTER TABLE public.dispute_messages ADD COLUMN is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE public.dispute_messages ADD COLUMN attachment_url text;

-- Harden the read policy: internal notes are admin-only. Everything else
-- about visibility (customer/restaurant owner+staff/assigned driver/admin)
-- is unchanged from the original policy.
DROP POLICY IF EXISTS "dispute_messages read" ON public.dispute_messages;
CREATE POLICY "dispute_messages read" ON public.dispute_messages FOR SELECT TO authenticated
  USING (
    (NOT is_internal OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
    AND EXISTS (
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

-- ---------------------------------------------------------------------------
-- 4) Storage bucket for dispute evidence, mirroring payment-proofs/
-- payout-proofs conventions exactly (private bucket, same size/MIME
-- limits). Folder is keyed by dispute_id (always known before an
-- attachment is added, unlike payout-proofs) -- any party who can see the
-- dispute can upload to it or read from it. An attachment on an internal
-- note is only ever linked to from the message itself, which the RLS
-- policy above already hides from non-admins -- the frontend never
-- surfaces that URL to a non-admin, so no separate per-attachment flag is
-- needed here.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('dispute-attachments', 'dispute-attachments', false, 8 * 1024 * 1024,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.dispute_folder_visible(_dispute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.dispute_author_role(d) IS NOT NULL FROM public.disputes d WHERE d.id = _dispute_id;
$$;
REVOKE ALL ON FUNCTION private.dispute_folder_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.dispute_folder_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "dispute attachments upload by party" ON storage.objects;
CREATE POLICY "dispute attachments upload by party"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'dispute-attachments'
  AND private.dispute_folder_visible(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "dispute attachments read by party" ON storage.objects;
CREATE POLICY "dispute attachments read by party"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'dispute-attachments'
  AND private.dispute_folder_visible(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "dispute attachments delete by admin" ON storage.objects;
CREATE POLICY "dispute attachments delete by admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'dispute-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
);

-- ---------------------------------------------------------------------------
-- 5) open_dispute_secure gains _category_group (new trailing param with a
-- default -> signature change, so the 3-arg overload must be dropped
-- first, same rule check-migration-hazards.mjs enforces everywhere else in
-- this project). Every existing caller (DisputeSection, and
-- dispute_cash_payment_secure below) keeps working unchanged since the new
-- param defaults. The reopen-on-resolved upsert branch is widened to also
-- reopen a rejected dispute -- 'rejected' is a new terminal status this
-- migration introduces, so the existing "resolved only" reopen rule would
-- otherwise silently strand rejected disputes with no way back to open.
DROP FUNCTION IF EXISTS public.open_dispute_secure(uuid, text, text);
CREATE FUNCTION public.open_dispute_secure(
  _order_id uuid, _category text, _description text, _category_group text DEFAULT 'delivery'
)
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
  v_author_role public.dispute_author_role;
  v_category_group text := COALESCE(NULLIF(btrim(_category_group), ''), 'delivery');
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
  IF v_category_group NOT IN ('payment', 'delivery', 'restaurant', 'driver') THEN
    RAISE EXCEPTION 'Gwoup kategori envalid';
  END IF;

  IF NOT public.check_rate_limit_secure('open_dispute', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  SELECT dr.id INTO v_driver_id
  FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
  WHERE de.order_id = _order_id;

  -- Customer or the assigned driver may open a dispute (widened in
  -- 20260722200000_...sql for cash-mismatch reports; kept identical here).
  IF NOT (
    v_order.customer_id = v_user
    OR (v_driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.id = v_driver_id AND dr.user_id = v_user))
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.disputes (order_id, customer_id, restaurant_id, driver_id, category, category_group)
  VALUES (_order_id, v_order.customer_id, v_order.restaurant_id, v_driver_id, btrim(_category), v_category_group)
  ON CONFLICT (order_id) DO UPDATE SET
    -- A previous dispute on this order was resolved or rejected -- a new
    -- problem reopens it. 'rejected' is a new terminal status introduced
    -- by this migration; without widening this clause a rejected dispute
    -- could never be reopened.
    status = 'open', category = EXCLUDED.category, category_group = EXCLUDED.category_group,
    driver_id = EXCLUDED.driver_id, assigned_to = NULL,
    status_history = disputes.status_history || jsonb_build_object(
      'from', disputes.status, 'to', 'open', 'by', v_user, 'at', now(), 'notes', 'reouvri'
    ),
    resolution = NULL, resolved_by = NULL, resolved_at = NULL, updated_at = now()
  WHERE disputes.status IN ('resolved', 'rejected')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gen deja yon litij louvri pou kòmand sa a';
  END IF;

  v_author_role := private.dispute_author_role(v_row);

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (v_row.id, v_user, COALESCE(v_author_role, 'customer'), btrim(_description));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r.owner_id, 'dispute_opened', 'Nouvo litij sou yon kòmand',
    'Yon ' || (CASE WHEN v_author_role = 'driver' THEN 'livrè' ELSE 'kliyan' END)
      || ' siyale yon pwoblèm sou kòmand ' || v_order.order_number || '.',
    jsonb_build_object('order_id', v_order.id, 'dispute_id', v_row.id)
  FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.open_dispute_secure(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_dispute_secure(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) add_dispute_message_secure gains _is_internal (forced false unless the
-- caller is admin -- never trusted from the client) and _attachment_url.
DROP FUNCTION IF EXISTS public.add_dispute_message_secure(uuid, text);
CREATE FUNCTION public.add_dispute_message_secure(
  _dispute_id uuid, _message text, _is_internal boolean DEFAULT false, _attachment_url text DEFAULT NULL
)
RETURNS public.dispute_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_role public.dispute_author_role;
  v_is_admin boolean;
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
  IF v_dispute.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Litij sa a deja fèmen';
  END IF;

  v_is_admin := public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin');

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message, is_internal, attachment_url)
  VALUES (_dispute_id, v_user, v_role, btrim(_message), _is_internal AND v_is_admin, _attachment_url)
  RETURNING * INTO v_row;

  UPDATE public.disputes SET updated_at = now() WHERE id = _dispute_id;

  -- Internal notes never notify the other parties -- they're not supposed
  -- to know it exists.
  IF NOT v_row.is_internal THEN
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
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_dispute_message_secure(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_dispute_message_secure(uuid, text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) resolve_dispute_secure: unchanged behavior, now also appends to
-- status_history so the timeline is complete (previously only
-- dispute_messages recorded that a resolution happened).
CREATE OR REPLACE FUNCTION public.resolve_dispute_secure(_dispute_id uuid, _resolution text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_old_status text;
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
  IF v_dispute.status IN ('resolved', 'rejected') THEN
    RAISE EXCEPTION 'Litij sa a deja fèmen';
  END IF;
  v_old_status := v_dispute.status;

  UPDATE public.disputes SET
    status = 'resolved', resolution = btrim(_resolution),
    resolved_by = v_user, resolved_at = now(), updated_at = now(),
    status_history = status_history || jsonb_build_object(
      'from', v_old_status, 'to', 'resolved', 'by', v_user, 'at', now(), 'notes', btrim(_resolution)
    )
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
-- Same signature as before -- no DROP/GRANT changes needed.

-- ---------------------------------------------------------------------------
-- 8) New: admin moves a dispute through the non-terminal-resolution states
-- (open/in_review/action_required/rejected/escalated). 'resolved' stays
-- exclusively resolve_dispute_secure's job (it requires a mandatory
-- `resolution` ruling text that this function doesn't collect). Optional
-- `_assigned_to`: when provided, claims/reassigns the dispute in the same
-- call rather than needing a second RPC.
CREATE OR REPLACE FUNCTION public.update_dispute_status_secure(
  _dispute_id uuid, _status text, _admin_notes text DEFAULT NULL, _assigned_to uuid DEFAULT NULL
)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dispute public.disputes;
  v_old_status text;
  v_status_changed boolean;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('open', 'in_review', 'action_required', 'rejected', 'escalated') THEN
    RAISE EXCEPTION 'Estati sa a envalid pou aksyon sa a';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  v_old_status := v_dispute.status;
  v_status_changed := v_old_status <> _status;
  -- _assigned_to alone (same _status as current) is how the "claim"/
  -- reassign action works from the admin UI -- allowed as a no-op on
  -- status as long as it actually changes the assignee.
  IF NOT v_status_changed AND _assigned_to IS NULL THEN
    RAISE EXCEPTION 'Anyen pa chanje';
  END IF;

  UPDATE public.disputes SET
    status = _status,
    assigned_to = COALESCE(_assigned_to, assigned_to),
    status_history = CASE WHEN v_status_changed THEN
      status_history || jsonb_build_object(
        'from', v_old_status, 'to', _status, 'by', v_user, 'at', now(), 'notes', _admin_notes
      )
      ELSE status_history END,
    updated_at = now()
  WHERE id = _dispute_id
  RETURNING * INTO v_dispute;

  IF v_status_changed AND _admin_notes IS NOT NULL AND length(btrim(_admin_notes)) > 0 THEN
    INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message, is_internal)
    VALUES (_dispute_id, v_user, 'admin', btrim(_admin_notes), true);
  END IF;

  IF v_status_changed THEN
    PERFORM private.log_audit_event(v_user, 'admin', 'dispute.status_changed',
      jsonb_build_object('dispute_id', _dispute_id, 'from', v_old_status, 'to', _status));
  ELSE
    PERFORM private.log_audit_event(v_user, 'admin', 'dispute.assigned',
      jsonb_build_object('dispute_id', _dispute_id, 'assigned_to', _assigned_to));
  END IF;

  RETURN v_dispute;
END;
$$;
REVOKE ALL ON FUNCTION public.update_dispute_status_secure(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_dispute_status_secure(uuid, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Admin list RPC, paginated/filterable/sortable -- replaces the current
-- `.limit(200)` client-side query in dashboard.admin.disputes.tsx.
CREATE OR REPLACE FUNCTION public.get_disputes_admin(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _category_group text DEFAULT NULL,
  _sort text DEFAULT 'created_desc', _limit int DEFAULT 20, _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, category text, category_group text,
  status text, customer_id uuid, restaurant_id uuid, restaurant_name text,
  driver_id uuid, driver_first_name text, driver_last_name text,
  assigned_to uuid, assigned_email text, resolution text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.order_id, o.order_number, d.category, d.category_group, d.status,
    d.customer_id, d.restaurant_id, r.name, d.driver_id, dr.first_name, dr.last_name,
    d.assigned_to, u.email, d.resolution, d.created_at, d.updated_at,
    count(*) OVER() AS total_count
  FROM public.disputes d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.restaurants r ON r.id = d.restaurant_id
  LEFT JOIN public.drivers dr ON dr.id = d.driver_id
  LEFT JOIN auth.users u ON u.id = d.assigned_to
  WHERE (_status IS NULL OR _status = '' OR d.status = _status)
    AND (_category_group IS NULL OR _category_group = '' OR d.category_group = _category_group)
    AND (
      _search IS NULL OR _search = ''
      OR o.order_number ILIKE '%' || _search || '%'
      OR r.name ILIKE '%' || _search || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'created_asc' THEN d.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'updated_desc' THEN d.updated_at END DESC NULLS LAST,
    d.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_disputes_admin(text, text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_disputes_admin(text, text, text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) dispute_cash_payment_secure (20260722200000_...sql): now tags the
-- dispute it opens as 'payment' category_group. Same signature, no DROP
-- needed -- only the body's call to open_dispute_secure gains the new
-- named argument.
CREATE OR REPLACE FUNCTION public.dispute_cash_payment_secure(_order_id uuid, _description text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.disputes;
BEGIN
  SELECT * INTO v_dispute FROM public.open_dispute_secure(
    _order_id, 'Peman kach pa kòrèk', _description, _category_group := 'payment'
  );

  UPDATE public.payments SET cash_confirmation_status = 'disputed', updated_at = now()
  WHERE order_id = _order_id AND method = 'kach';

  RETURN v_dispute;
END;
$$;
-- Same signature as before -- no DROP/GRANT changes needed.
