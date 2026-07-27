-- Rest of Phase 10 (notifications center): targeted promotional pushes on
-- top of the private.notify_secure engine built earlier. Distinct from
-- `sponsored_placements` (on-page ad cards, already shipped) -- this is a
-- proactive push/in-app notification campaign, gated by each recipient's
-- own promotion opt-in (private.notify_secure already skips anyone who
-- hasn't enabled the 'promotion' category) plus an explicit cooldown so
-- no user gets more than one promotional notification per configurable
-- window, regardless of how many campaigns an admin sends.

-- Serves send_promotional_notification_secure's per-recipient cooldown
-- check below (WHERE user_id=... AND category='promotion' AND
-- created_at > ...) -- the existing idx_notif_user(user_id, created_at)
-- index doesn't cover `category`, so without this Postgres would filter
-- it row-by-row after the user_id lookup instead of using the index
-- directly for the whole predicate.
CREATE INDEX IF NOT EXISTS notifications_user_category_created_idx
  ON public.notifications(user_id, category, created_at DESC);

CREATE TABLE public.promotional_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  target_role text NOT NULL DEFAULT 'all'
    CHECK (target_role IN ('all', 'customer', 'restaurant_owner', 'driver')),
  target_city text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by uuid NOT NULL REFERENCES auth.users(id),
  recipient_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.promotional_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotional_notifications FROM PUBLIC, anon;
GRANT SELECT ON public.promotional_notifications TO authenticated;
CREATE POLICY "promotional_notifications admin read" ON public.promotional_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
-- No client write grant -- the RPC below is the only write path.

CREATE OR REPLACE FUNCTION public.send_promotional_notification_secure(
  _title text, _body text, _target_role text DEFAULT 'all', _target_city text DEFAULT NULL,
  _data jsonb DEFAULT '{}'::jsonb, _cooldown_hours int DEFAULT 24
)
RETURNS public.promotional_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_recipients uuid[];
  v_row public.promotional_notifications;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tit la obligatwa';
  END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN
    RAISE EXCEPTION 'Kontni a obligatwa';
  END IF;
  IF _target_role NOT IN ('all', 'customer', 'restaurant_owner', 'driver') THEN
    RAISE EXCEPTION 'Sib envalid';
  END IF;

  -- 'customer' has no explicit user_roles row in this app's model (only
  -- staff/driver/restaurant_owner/admin get one -- confirmed by
  -- get_primary_role defaulting an unlisted user to 'customer' rather
  -- than reading a row for it) -- targeting plain customers means
  -- profiles with no role row at all.
  SELECT ARRAY(
    SELECT DISTINCT p.id FROM public.profiles p
    WHERE (
      _target_role = 'all'
      OR (_target_role = 'customer' AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id))
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _target_role)
    )
    AND (_target_city IS NULL OR btrim(_target_city) = '' OR p.address ILIKE '%' || _target_city || '%')
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.id AND n.category = 'promotion'
        AND n.created_at > now() - make_interval(hours => GREATEST(_cooldown_hours, 1))
    )
  ) INTO v_recipients;

  INSERT INTO public.promotional_notifications
    (title, body, target_role, target_city, data, sent_by, recipient_count)
  VALUES (
    btrim(_title), btrim(_body), _target_role, NULLIF(btrim(_target_city), ''), _data, v_user,
    COALESCE(array_length(v_recipients, 1), 0)
  )
  RETURNING * INTO v_row;

  PERFORM private.notify_secure(
    v_recipients, 'promotional_notification', 'promotion', btrim(_title), btrim(_body), _data
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.send_promotional_notification_secure(text, text, text, text, jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_promotional_notification_secure(text, text, text, text, jsonb, int) TO authenticated;
