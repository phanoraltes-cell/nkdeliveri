-- Phase 6 of the admin evolution plan: sponsored placements. Deliberately
-- not a bidding engine -- a flat table of scheduled ad cards an admin
-- creates/edits directly, shown in 4 fixed zones (home banner, search
-- results, restaurant page, dashboard), each capped to a small count so no
-- placement can ever become a popup/full-screen takeover -- that's not an
-- option this schema or the RPC below expose at all, not just a rule the
-- frontend is asked to follow.
--
-- Distinct from the existing `promotions` table (restaurant-level discount
-- codes, e.g. "20% off with code SUMMER") -- sponsored_placements is a
-- platform-level ad slot an admin sells/assigns, unrelated to checkout
-- discounts.

CREATE TABLE public.sponsored_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement text NOT NULL CHECK (placement IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard')),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  title text NOT NULL,
  image_url text,
  link_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX sponsored_placements_placement_idx ON public.sponsored_placements(placement);
CREATE INDEX sponsored_placements_restaurant_id_idx ON public.sponsored_placements(restaurant_id);

DROP TRIGGER IF EXISTS trg_sponsored_placements_upd ON public.sponsored_placements;
CREATE TRIGGER trg_sponsored_placements_upd BEFORE UPDATE ON public.sponsored_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sponsored_placements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.sponsored_placements TO anon, authenticated;
GRANT ALL ON public.sponsored_placements TO service_role;

-- Public (including anonymous visitors browsing home/search) sees only
-- active rows within their scheduled window, and only when they reference
-- an approved restaurant or no restaurant at all (generic banner). Admin
-- sees everything, including expired/inactive rows, to manage the list.
-- No direct INSERT/UPDATE/DELETE grant for authenticated -- all writes go
-- through the *_sponsored_placement_secure RPCs below (same convention as
-- promotions).
CREATE POLICY "sponsored_placements read" ON public.sponsored_placements FOR SELECT
  USING (
    (
      is_active AND now() >= starts_at AND now() <= ends_at
      AND (
        restaurant_id IS NULL
        OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.status = 'approved')
      )
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- ---------------------------------------------------------------------------
-- Public read: active placements for one zone, joined to the restaurant
-- card fields a placement links to (when it has one). STABLE + SECURITY
-- DEFINER purely so the join to `restaurants` never depends on the
-- caller's own restaurant-read grants -- the RLS policy above already
-- guarantees only currently-eligible rows come back regardless.
CREATE OR REPLACE FUNCTION public.get_active_placements_secure(_placement text, _limit int DEFAULT 5)
RETURNS TABLE (
  id uuid, placement text, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  restaurant_cover_url text, restaurant_cuisine text, restaurant_rating numeric,
  restaurant_avg_prep_time int, restaurant_delivery_fee numeric, restaurant_address text,
  title text, image_url text, link_url text, sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.id, sp.placement, sp.restaurant_id, r.name, r.slug, r.cover_url, r.cuisine,
    r.rating, r.avg_prep_time, r.delivery_fee, r.address,
    sp.title, sp.image_url, sp.link_url, sp.sort_order
  FROM public.sponsored_placements sp
  LEFT JOIN public.restaurants r ON r.id = sp.restaurant_id
  WHERE sp.placement = _placement
    AND sp.is_active AND now() >= sp.starts_at AND now() <= sp.ends_at
    AND (sp.restaurant_id IS NULL OR r.status = 'approved')
  ORDER BY sp.sort_order ASC, sp.created_at DESC
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.get_active_placements_secure(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_placements_secure(text, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin CRUD. `placement` and `restaurant_id` are set once at creation and
-- not editable after (changing what a placement *is* vs. its schedule/
-- content is a delete-and-recreate, same as every other admin list in this
-- app treats identity-defining fields).
CREATE OR REPLACE FUNCTION public.create_sponsored_placement_secure(
  _placement text, _title text, _starts_at timestamptz, _ends_at timestamptz,
  _restaurant_id uuid DEFAULT NULL, _image_url text DEFAULT NULL, _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _placement NOT IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard') THEN
    RAISE EXCEPTION 'Anplasman envalid';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;

  INSERT INTO public.sponsored_placements
    (placement, restaurant_id, title, image_url, link_url, starts_at, ends_at, sort_order, created_by)
  VALUES
    (_placement, _restaurant_id, btrim(_title), _image_url, _link_url, _starts_at, _ends_at, _sort_order, v_user)
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_sponsored_placement_secure(
  _id uuid, _title text, _starts_at timestamptz, _ends_at timestamptz, _is_active boolean,
  _image_url text DEFAULT NULL, _link_url text DEFAULT NULL, _sort_order int DEFAULT 0
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;

  UPDATE public.sponsored_placements SET
    title = btrim(_title), image_url = _image_url, link_url = _link_url,
    starts_at = _starts_at, ends_at = _ends_at, is_active = _is_active, sort_order = _sort_order
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_sponsored_placement_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sponsored_placements WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_sponsored_placement_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_sponsored_placement_secure(uuid) TO authenticated;
