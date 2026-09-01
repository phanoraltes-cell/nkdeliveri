-- Komand — admin order supervision module (docs/archive/audits/KOMAND_ADMIN_AUDIT.md Phase 1,
-- validated; this migration implements the Phase 2 decisions). Pure
-- supervision layer: never writes to orders.status, never a second order
-- workflow. Two new tables (the only new state Komand actually needs),
-- six new/changed admin RPC (get_orders_admin, get_order_admin_detail,
-- add_order_admin_note_secure, set_komand_assistance_secure,
-- log_komand_contact_secure, and an additive _customer_id filter on the
-- pre-existing get_customers_admin), one new notification hook into the
-- existing handle_new_user() trigger.

-- ---------------------------------------------------------------------------
-- 1) order_admin_notes — internal notes, admin/super_admin only, never
--    visible to customer/restaurant/driver. Append-only (same
--    private.prevent_log_mutation() guard already reused 5 times in this
--    project for exactly this "never silently edited or deleted" property).
CREATE TABLE public.order_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_admin_notes_order_id_idx ON public.order_admin_notes(order_id);
ALTER TABLE public.order_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_admin_notes FROM PUBLIC, anon;
GRANT SELECT ON public.order_admin_notes TO authenticated;
CREATE POLICY "order_admin_notes admin read" ON public.order_admin_notes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
-- Write only via add_order_admin_note_secure() below (SECURITY DEFINER) —
-- no direct INSERT policy, matching plop_api_logs/newsletter_send_log's
-- own "writes only through the RPC" convention.
CREATE TRIGGER order_admin_notes_no_update_delete
  BEFORE UPDATE OR DELETE ON public.order_admin_notes
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();
CREATE TRIGGER order_admin_notes_no_truncate
  BEFORE TRUNCATE ON public.order_admin_notes
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

-- ---------------------------------------------------------------------------
-- 2) komand_assistance — administrative supervision state, deliberately
--    separate from orders.status (Règle §7 of the Komand brief: "une
--    intervention administrative ne doit jamais transformer arbitrairement
--    une commande"). order_id is the PRIMARY KEY (not a log table) — this
--    is what structurally guarantees "une commande ne peut pas avoir
--    plusieurs états d'assistance actifs simultanément": there is
--    physically only one row per order, ever, updated in place.
--    status_history mirrors the same jsonb-array append pattern already
--    used on orders/refunds/disputes for full traceability of transitions
--    without a second table.
CREATE TABLE public.komand_assistance (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'required', 'in_progress', 'resolved')),
  assigned_admin_id uuid REFERENCES auth.users(id),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.komand_assistance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.komand_assistance FROM PUBLIC, anon;
GRANT SELECT ON public.komand_assistance TO authenticated;
CREATE POLICY "komand_assistance admin read" ON public.komand_assistance FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
-- Write only via set_komand_assistance_secure() below — never a raw
-- UPDATE, so a status transition always goes through validation + audit
-- logging + status_history append together, never one without the others.

-- ---------------------------------------------------------------------------
-- 2bis) notifications.category CHECK constraint currently allows exactly
--       ('order','delivery','payment','commission','promotion','dispute',
--       'system') — confirmed live via pg_constraint before writing this,
--       not assumed. 'admin' is a new, minimal, additive value for the
--       "nouveau Client inscrit" notification (§3 below) — every existing
--       value is preserved unchanged, nothing removed or renamed.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category = ANY (ARRAY['order', 'delivery', 'payment', 'commission', 'promotion', 'dispute', 'system', 'admin']));

-- ---------------------------------------------------------------------------
-- 3) Notification hook — "nouveau Client inscrit". Added to the EXISTING
--    handle_new_user() trigger's customer branch (confirmed in
--    docs/archive/audits/KOMAND_ADMIN_AUDIT.md §10 as the correct provisioning-complete
--    anchor — same trigger already deeply audited during the 2026-08-11
--    SMTP incident). Full body reproduced unchanged except for the one
--    added PERFORM (diffed against pg_get_functiondef() before writing
--    this, not retyped from memory) — CREATE OR REPLACE requires the
--    complete function body, this is not a partial patch.
--    Idempotent by construction: this is an AFTER INSERT trigger on
--    auth.users, so it fires exactly once per real signup row — there is
--    no retry path that re-fires it for the same user (a repeated
--    signUp() call for an already-existing email fails before any INSERT
--    happens at all, confirmed during the SMTP incident audit).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_type text := COALESCE(NEW.raw_user_meta_data->>'account_type', 'customer');
  v_first_name text := NEW.raw_user_meta_data->>'first_name';
  v_last_name text := NEW.raw_user_meta_data->>'last_name';
  v_phone text := NEW.raw_user_meta_data->>'phone';
  v_address text := NEW.raw_user_meta_data->>'address';
  v_slug text;
  v_hours jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, avatar_url, phone, address)
  VALUES (
    NEW.id, v_first_name, v_last_name,
    NEW.raw_user_meta_data->>'avatar_url', v_phone, v_address
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_account_type = 'restaurant' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'restaurant_owner')
      ON CONFLICT DO NOTHING;
    v_slug := trim(both '-' from regexp_replace(
                lower(COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'restoran')),
                '[^a-z0-9]+', '-', 'g'
              ))
              || '-' || substr(NEW.id::text, 1, 8);

    -- restaurant_hours arrives as a JSON-encoded *string* (restaurant-form.tsx
    -- sends it via the same Record<string,string> metadata contract every
    -- signup form uses), not a nested object -- decode with ->> then ::jsonb,
    -- never with the bare -> operator (which would keep an already-jsonb
    -- string value as a jsonb *scalar*, not parse it). Defensive: a
    -- malformed or foreign value here (raw_user_meta_data is fully caller-
    -- controlled at the GoTrue signup API, not just via this form) must
    -- never abort the whole account creation -- falls back to the same
    -- '{}' default this project has always had.
    BEGIN
      v_hours := COALESCE(NULLIF(NEW.raw_user_meta_data->>'restaurant_hours', '')::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_hours := '{}'::jsonb;
    END;
    IF NOT public.is_valid_opening_hours_shape(v_hours) THEN
      v_hours := '{}'::jsonb;
    END IF;

    INSERT INTO public.restaurants (
      owner_id, name, slug, description, cuisine, phone, address, logo_url, cover_url, opening_hours, status
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'Restoran mwen'),
      v_slug,
      NEW.raw_user_meta_data->>'restaurant_description',
      NEW.raw_user_meta_data->>'restaurant_cuisine',
      v_phone,
      NEW.raw_user_meta_data->>'restaurant_address',
      NEW.raw_user_meta_data->>'restaurant_logo_url',
      NEW.raw_user_meta_data->>'restaurant_cover_url',
      v_hours,
      'pending'
    );

  ELSIF v_account_type = 'driver' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'driver')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.drivers (
      user_id, first_name, last_name, phone, address, vehicle_type, license_plate,
      id_doc_url, license_doc_url, vehicle_photo_url, status
    ) VALUES (
      NEW.id, v_first_name, v_last_name, v_phone, v_address,
      NEW.raw_user_meta_data->>'vehicle_type',
      NEW.raw_user_meta_data->>'license_plate',
      NEW.raw_user_meta_data->>'id_doc_url',
      NEW.raw_user_meta_data->>'license_doc_url',
      NEW.raw_user_meta_data->>'vehicle_photo_url',
      'pending'
    );

  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer')
      ON CONFLICT DO NOTHING;

    -- Komand — "nouveau Client inscrit" (docs/archive/audits/KOMAND_ADMIN_AUDIT.md §10).
    -- Reuses the exact recipient pattern already used 8 times in this
    -- project (dispute/cancellation/payment-error notifications):
    -- every admin + super_admin, nothing else. New category 'admin' —
    -- notification_preferences_for() already defaults any unrecognized
    -- category to enabled, so no preferences-UI change is needed for
    -- this to reach every admin by default.
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'new_customer_signup',
      'admin',
      'Nouvo kliyan enskri',
      trim(both ' ' from COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, '')) || ' fèk kreye yon kont kliyan.',
      jsonb_build_object('customer_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) get_orders_admin — the Komand list. SECURITY DEFINER, admin-gated,
--    exactly the established get_*_admin pattern (get_drivers_admin,
--    get_disputes_admin, get_customers_admin: _search/_limit/_offset,
--    returns total_count on every row for pagination). Computes "Komand
--    Health" (docs/archive/audits/KOMAND_ADMIN_AUDIT.md §5, refined per Phase 2
--    validation into 7 distinct buckets, never written back to
--    orders.status) directly in SQL from already-existing columns —
--    nothing new stored, only derived at read time.
--
--    Staleness thresholds ("blocked"/"warning") below are NOT uniformly
--    invented — each is labeled with its real source:
--      - Prep-time thresholds use restaurants.avg_prep_time (real,
--        per-restaurant, already customer-facing data) rather than one
--        flat number for every restaurant.
--      - Automatic-payment thresholds (MonCash/NatCash Automatik,
--        Stripe) reuse the EXACT figures already live and approved in
--        dashboard.admin.collect.tsx's STUCK_PENDING_MINUTES constant
--        (moncash/natcash: 1440 min / 24h — matches "PLOP's only safety
--        net beyond the client poll is a once-daily cron"; stripe: 120
--        min / 2h) — not reinvented here, just applied to the same
--        underlying payments/payment_transactions data from the Komand
--        angle.
--      - Every other threshold (restaurant confirmation, driver
--        assignment, delivery, manual proof upload, cash double-
--        confirmation) has **no existing precedent anywhere in this
--        codebase** — these are explicitly flagged in
--        docs/archive/audits/KOMAND_ADMIN_IMPLEMENTATION_REPORT.md as provisional
--        starting values to validate operationally, not derived business
--        rules, per the explicit instruction not to fabricate them as
--        certainties. All of them are simple literal minute counts
--        directly inside this function so adjusting one later is a
--        one-line CREATE OR REPLACE, never a schema change.
CREATE OR REPLACE FUNCTION public.get_orders_admin(
  _search text DEFAULT NULL,
  _health text DEFAULT NULL,
  _order_status public.order_status DEFAULT NULL,
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  order_number text,
  status public.order_status,
  total numeric,
  created_at timestamptz,
  last_activity timestamptz,
  customer_id uuid,
  customer_name text,
  restaurant_id uuid,
  restaurant_name text,
  driver_id uuid,
  driver_name text,
  payment_status text,
  payment_method text,
  cash_confirmation_status text,
  delivery_status text,
  dispute_open boolean,
  refund_status text,
  assistance_status text,
  komand_health text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 200 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      o.id, o.order_number, o.status, o.total, o.created_at, o.updated_at,
      o.customer_id,
      trim(both ' ' from COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')) AS customer_name,
      o.restaurant_id, r.name AS restaurant_name, r.avg_prep_time,
      d.driver_id, trim(both ' ' from COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) AS driver_name,
      d.status::text AS delivery_status, d.updated_at AS delivery_updated_at,
      p.status::text AS payment_status, p.method::text AS payment_method,
      p.cash_confirmation_status::text AS cash_confirmation_status, p.updated_at AS payment_updated_at,
      disp.dispute_open,
      ref.refund_status,
      COALESCE(ka.status, 'none') AS assistance_status,
      GREATEST(o.updated_at, COALESCE(d.updated_at, o.updated_at), COALESCE(p.updated_at, o.updated_at)) AS last_activity
    FROM public.orders o
    LEFT JOIN public.profiles cp ON cp.id = o.customer_id
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
    LEFT JOIN public.deliveries d ON d.order_id = o.id
    LEFT JOIN public.drivers dr ON dr.id = d.driver_id
    LEFT JOIN LATERAL (
      SELECT p2.status, p2.method, p2.cash_confirmation_status, p2.updated_at
      FROM public.payments p2 WHERE p2.order_id = o.id
      ORDER BY p2.created_at DESC LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      -- disputes.status is a free-text CHECK constraint in practice
      -- ('open','in_review','action_required','resolved','rejected',
      -- 'escalated'), not the narrower dispute_status enum ('open'/
      -- 'resolved') that migration history originally declared —
      -- confirmed live via pg_constraint before writing this. Only
      -- 'resolved'/'rejected' are actually terminal; every other value
      -- still needs admin attention.
      SELECT (dis.status NOT IN ('resolved', 'rejected')) AS dispute_open
      FROM public.disputes dis WHERE dis.order_id = o.id
      ORDER BY dis.created_at DESC LIMIT 1
    ) disp ON true
    LEFT JOIN LATERAL (
      SELECT rf.status::text AS refund_status
      FROM public.refunds rf WHERE rf.order_id = o.id
      ORDER BY rf.created_at DESC LIMIT 1
    ) ref ON true
    LEFT JOIN public.komand_assistance ka ON ka.order_id = o.id
  ),
  classified AS (
    SELECT
      base.*,
      CASE
        -- Assistance: highest priority, always wins regardless of timing.
        WHEN base.assistance_status IN ('required', 'in_progress') THEN 'assistance_required'
        WHEN base.dispute_open IS TRUE THEN 'assistance_required'
        WHEN base.refund_status = 'requested' THEN 'assistance_required'
        WHEN base.payment_status = 'under_review' THEN 'assistance_required'
        WHEN base.cash_confirmation_status = 'disputed' THEN 'assistance_required'

        -- Terminal buckets, own filters, never "complete"/"incomplete".
        WHEN base.status = 'cancelled' THEN 'cancelled'
        WHEN base.status = 'refunded' THEN 'refunded'

        -- Blocked: real staleness, per stage. See migration header for
        -- which of these are grounded vs provisional.
        WHEN base.status = 'pending' AND now() - base.created_at > interval '20 minutes' THEN 'blocked'
        WHEN base.status IN ('confirmed', 'preparing')
          AND now() - base.updated_at > (COALESCE(base.avg_prep_time, 30) + 20) * interval '1 minute' THEN 'blocked'
        WHEN base.status = 'ready' AND base.driver_id IS NULL AND now() - base.updated_at > interval '30 minutes' THEN 'blocked'
        WHEN base.status IN ('assigned', 'picked_up') AND now() - base.updated_at > interval '90 minutes' THEN 'blocked'
        WHEN base.payment_method IN ('moncash', 'natcash') AND base.payment_status = 'pending'
          AND now() - base.payment_updated_at > interval '1440 minutes' THEN 'blocked'
        WHEN base.payment_method = 'stripe' AND base.payment_status = 'pending'
          AND now() - base.payment_updated_at > interval '120 minutes' THEN 'blocked'
        WHEN base.payment_status = 'awaiting_proof' AND now() - base.payment_updated_at > interval '60 minutes' THEN 'blocked'
        WHEN base.status = 'delivered' AND base.cash_confirmation_status IS NOT NULL
          AND base.cash_confirmation_status <> 'validated'
          AND now() - base.delivery_updated_at > interval '60 minutes' THEN 'blocked'

        -- Incomplete: missing a required piece, not yet stale enough to be "blocked".
        WHEN base.status = 'pending' THEN 'incomplete'
        WHEN base.status IN ('confirmed', 'preparing') THEN 'incomplete'
        WHEN base.status = 'ready' AND base.driver_id IS NULL THEN 'incomplete'
        WHEN base.payment_status IN ('pending', 'awaiting_proof') AND base.status <> 'pending' THEN 'incomplete'

        -- Complete: delivered, paid, no open issue.
        WHEN base.status = 'delivered' AND base.payment_status = 'paid'
          AND (base.cash_confirmation_status IS NULL OR base.cash_confirmation_status = 'validated')
          THEN 'complete'

        -- Everything else still active and on track.
        ELSE 'en_cours'
      END AS komand_health
    FROM base
  ),
  filtered AS (
    -- Every column qualified with the CTE alias: this function's own OUT
    -- parameters (order_number, status, restaurant_id, driver_id, ...)
    -- share names with these columns, and plpgsql resolves a bare
    -- identifier against its own variables/params before table columns —
    -- confirmed live (42702 ambiguous column) while testing this, not a
    -- style preference.
    SELECT * FROM classified
    WHERE (_search IS NULL OR classified.order_number ILIKE '%' || _search || '%' OR classified.customer_name ILIKE '%' || _search || '%' OR classified.restaurant_name ILIKE '%' || _search || '%')
      AND (_health IS NULL OR classified.komand_health = _health)
      AND (_order_status IS NULL OR classified.status = _order_status)
      AND (_restaurant_id IS NULL OR classified.restaurant_id = _restaurant_id)
      AND (_driver_id IS NULL OR classified.driver_id = _driver_id)
  )
  SELECT
    filtered.id, filtered.order_number, filtered.status, filtered.total, filtered.created_at,
    filtered.last_activity, filtered.customer_id, filtered.customer_name, filtered.restaurant_id,
    filtered.restaurant_name, filtered.driver_id, filtered.driver_name, filtered.payment_status,
    filtered.payment_method, filtered.cash_confirmation_status, filtered.delivery_status,
    filtered.dispute_open, filtered.refund_status, filtered.assistance_status, filtered.komand_health,
    count(*) OVER ()::bigint AS total_count
  FROM filtered
  ORDER BY filtered.last_activity DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_orders_admin(text, text, public.order_status, uuid, uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_admin(text, text, public.order_status, uuid, uuid, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) get_order_admin_detail — single-order supervision view (client,
--    restaurant, driver, payment, delivery, timeline, notes, assistance).
--    Re-validates has_role independently (Règle §15 of the audit — a
--    future caller of this RPC must never rely solely on the list RPC's
--    own gate).
CREATE OR REPLACE FUNCTION public.get_order_admin_detail(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'order', to_jsonb(o.*),
    'customer', jsonb_build_object('id', cp.id, 'first_name', cp.first_name, 'last_name', cp.last_name, 'phone', cp.phone, 'email', cu.email),
    'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'status', r.status, 'avg_prep_time', r.avg_prep_time),
    'driver', CASE WHEN dr.id IS NULL THEN NULL ELSE jsonb_build_object('id', dr.id, 'first_name', dr.first_name, 'last_name', dr.last_name, 'phone', dr.phone, 'status', dr.status) END,
    'delivery', to_jsonb(d.*),
    'payment', to_jsonb(p.*),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(oi.*)) FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb),
    'dispute', (SELECT to_jsonb(dis.*) FROM public.disputes dis WHERE dis.order_id = o.id ORDER BY dis.created_at DESC LIMIT 1),
    'refund', (SELECT to_jsonb(rf.*) FROM public.refunds rf WHERE rf.order_id = o.id ORDER BY rf.created_at DESC LIMIT 1),
    'assistance', to_jsonb(ka.*),
    'notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note', n.note, 'created_at', n.created_at,
        'author_id', n.author_id, 'author_name', trim(both ' ' from COALESCE(ap.first_name,'') || ' ' || COALESCE(ap.last_name,''))
      ) ORDER BY n.created_at DESC)
      FROM public.order_admin_notes n LEFT JOIN public.profiles ap ON ap.id = n.author_id
      WHERE n.order_id = o.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.orders o
  LEFT JOIN public.profiles cp ON cp.id = o.customer_id
  LEFT JOIN auth.users cu ON cu.id = o.customer_id
  LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
  LEFT JOIN public.deliveries d ON d.order_id = o.id
  LEFT JOIN public.drivers dr ON dr.id = d.driver_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.payments p2 WHERE p2.order_id = o.id ORDER BY p2.created_at DESC LIMIT 1
  ) p ON true
  LEFT JOIN public.komand_assistance ka ON ka.order_id = o.id
  WHERE o.id = _order_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_admin_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_admin_detail(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) add_order_admin_note_secure — the only way to write order_admin_notes.
CREATE OR REPLACE FUNCTION public.add_order_admin_note_secure(_order_id uuid, _note text)
RETURNS public.order_admin_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.order_admin_notes;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _note IS NULL OR length(btrim(_note)) = 0 THEN
    RAISE EXCEPTION 'Nòt la pa ka vid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _order_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.order_admin_notes (order_id, author_id, note)
  VALUES (_order_id, v_user, btrim(_note))
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, private.get_primary_role(v_user), 'komand_assistance_note_added',
    jsonb_build_object('order_id', _order_id, 'note_id', v_row.id));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.add_order_admin_note_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_order_admin_note_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) set_komand_assistance_secure — the only way to write komand_assistance.
--    Upserts the single row for this order (PK = order_id structurally
--    prevents more than one active state — see table comment). Appends to
--    status_history, sets resolved_by/resolved_at only on the transition
--    into 'resolved', and logs a distinct audit action per transition
--    kind (started/assigned/resolved) rather than one generic "changed"
--    event, matching the exact action names validated in Phase 2.
CREATE OR REPLACE FUNCTION public.set_komand_assistance_secure(
  _order_id uuid,
  _status text,
  _assigned_admin_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS public.komand_assistance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_row public.komand_assistance;
  v_action text;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('none', 'required', 'in_progress', 'resolved') THEN
    RAISE EXCEPTION 'Invalid assistance status' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _order_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  v_role := private.get_primary_role(v_user);

  v_action := CASE
    WHEN _status = 'required' THEN 'komand_assistance_started'
    WHEN _status = 'in_progress' AND _assigned_admin_id IS NOT NULL THEN 'komand_assistance_assigned'
    WHEN _status = 'resolved' THEN 'komand_assistance_resolved'
    ELSE 'komand_assistance_note_added'
  END;

  INSERT INTO public.komand_assistance (order_id, status, assigned_admin_id, resolved_by, resolved_at, status_history)
  VALUES (
    _order_id, _status, _assigned_admin_id,
    CASE WHEN _status = 'resolved' THEN v_user ELSE NULL END,
    CASE WHEN _status = 'resolved' THEN now() ELSE NULL END,
    jsonb_build_array(jsonb_build_object('to', _status, 'by', v_user, 'at', now(), 'note', _note))
  )
  ON CONFLICT (order_id) DO UPDATE SET
    status = _status,
    assigned_admin_id = COALESCE(_assigned_admin_id, public.komand_assistance.assigned_admin_id),
    resolved_by = CASE WHEN _status = 'resolved' THEN v_user ELSE public.komand_assistance.resolved_by END,
    resolved_at = CASE WHEN _status = 'resolved' THEN now() ELSE public.komand_assistance.resolved_at END,
    status_history = public.komand_assistance.status_history
      || jsonb_build_object('to', _status, 'by', v_user, 'at', now(), 'note', _note),
    updated_at = now()
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, v_role, v_action,
    jsonb_build_object('order_id', _order_id, 'status', _status, 'assigned_admin_id', _assigned_admin_id));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_komand_assistance_secure(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_komand_assistance_secure(uuid, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) komand_client_contacted / komand_restaurant_contacted / komand_driver_contacted
--    (Règle §4 of the Komand brief) — "contacter" reuses the EXISTING
--    order-chat system (dashboard.admin.chat.tsx already deep-links via
--    ?order=<id>, order_chat_messages already lets an admin post into any
--    order's thread — confirmed live in docs/archive/audits/KOMAND_ADMIN_AUDIT.md §8).
--    No new RPC needed for the contact action itself; only a thin logging
--    call so it's traceable per Règle §16. Allowlisted _action, mirrors
--    log_admin_step_up_event_secure's own shape from the previous
--    security remediation.
CREATE OR REPLACE FUNCTION public.log_komand_contact_secure(_order_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('komand_client_contacted', 'komand_restaurant_contacted', 'komand_driver_contacted') THEN
    RAISE EXCEPTION 'Invalid event' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _order_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM private.log_audit_event(auth.uid(), private.get_primary_role(auth.uid()), _action,
    jsonb_build_object('order_id', _order_id));
END;
$$;
REVOKE ALL ON FUNCTION public.log_komand_contact_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_komand_contact_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) get_customers_admin: add an additive _customer_id exact-match filter.
--    Règle §5 of the Komand brief — the "nouveau Client inscrit"
--    notification must link into the EXISTING client list/search, never a
--    new client-management page. That list's own RPC only filters by a
--    free-text _search matched against email/name/phone, which a bare
--    customer_id can't drive — this adds the one missing, additive
--    parameter (defaulted, so every existing caller is unaffected) rather
--    than duplicating get_customers_admin or building a second lookup.
--    Full body reproduced from 20260714121500_paginate_admin_lists.sql,
--    unchanged except for the new parameter and its one WHERE clause.
--    Signature is changing (new parameter) — DROP FUNCTION first, same
--    documented reason as that migration's own header.
DROP FUNCTION IF EXISTS public.get_customers_admin(text, int, int);
CREATE FUNCTION public.get_customers_admin(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _customer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  address text,
  created_at timestamptz,
  total_orders bigint,
  total_spent numeric,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.address,
    p.created_at,
    COUNT(o.id)::bigint,
    COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0),
    count(*) OVER()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'customer'
  LEFT JOIN public.orders o ON o.customer_id = p.id
  WHERE (_customer_id IS NOT NULL AND p.id = _customer_id)
     OR (_customer_id IS NULL AND (
       _search IS NULL
       OR u.email ILIKE '%' || _search || '%'
       OR p.first_name ILIKE '%' || _search || '%'
       OR p.last_name ILIKE '%' || _search || '%'
       OR p.phone ILIKE '%' || _search || '%'
     ))
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.address, p.created_at
  ORDER BY p.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customers_admin(text, int, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_admin(text, int, int, uuid) TO authenticated;
