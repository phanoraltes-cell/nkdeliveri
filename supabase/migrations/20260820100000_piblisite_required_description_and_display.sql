-- Piblisite refonte — swiv demand itilizatè a apre Étape 4 (odit "Erè
-- pandan anrejistreman" te yon erè bò kote itilizatè a, pa yon bug reyèl —
-- pa gen okenn korije kòd ki mande pou sa):
--   1) Deskripsyon anons lan (`description`) vin OBLIGATWA — menm modèl
--      validasyon ak `_title` ki deja egziste nan tou de RPC yo.
--   2) `get_active_placements_secure` (RPC li piblik, itilize pa
--      useActivePlacements) kounye a retounen chan medya yo (media_type,
--      media_url, thumbnail_url, alt_text, link_target, cta_label,
--      description, media_items) — san sa, medya Étape 2/3/4 yo pa ka janm
--      afiche sou sit piblik la, menmsi yo byen anrejistre nan admin lan.
--
-- Règ A5-style: touche kontni piblisitè, pa peman/kòmand/komisyon — pa
-- mande yon "kanpe epi mande" separe.
--
-- ROLLBACK:
--   -- Re-aplike kò orijinal 2 RPC yo (san chèk deskripsyon) verbatim,
--   -- soti nan 20260819130000_sponsored_placements_media.sql:157-289.
--   DROP FUNCTION IF EXISTS public.get_active_placements_secure(text, int);
--   -- Re-kreye siyati orijinal la (san chan medya) verbatim, soti nan
--   -- 20260722220000_sponsored_placements.sql.
--
-- Wrapped BEGIN...COMMIT (A11).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) create/update_sponsored_placement_secure — CREATE OR REPLACE senpman:
--    siyati a (lis paramèt/tip retou) pa chanje, sèl kò fonksyon an chanje
--    (ajoute yon chèk), donk pa gen bezwen DROP+CREATE isit la (kontrèman ak
--    Étape 2, kote lis paramèt yo te chanje).
CREATE OR REPLACE FUNCTION public.create_sponsored_placement_secure(
  _placement text,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _restaurant_id uuid DEFAULT NULL,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
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
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  INSERT INTO public.sponsored_placements (
    placement, restaurant_id, title, image_url, link_url, starts_at, ends_at, sort_order, created_by,
    media_type, media_url, media_path, thumbnail_url, media_items, alt_text, link_target, cta_label,
    description, is_active
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_sponsored_placement_secure(
  _id uuid,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _is_active boolean,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  UPDATE public.sponsored_placements SET
    title = btrim(_title), image_url = v_media_url, link_url = _link_url,
    starts_at = _starts_at, ends_at = _ends_at, is_active = _is_active, sort_order = _sort_order,
    media_type = _media_type, media_url = v_media_url, media_path = _media_path,
    thumbnail_url = _thumbnail_url, media_items = _media_items, alt_text = _alt_text,
    link_target = _link_target, cta_label = _cta_label, description = btrim(_description)
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
-- Grants unchanged from Étape 2 — same signatures, CREATE OR REPLACE keeps
-- existing grants intact regardless, but re-stated explicitly (cheap,
-- idempotent, and removes any doubt reading this file in isolation).
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) get_active_placements_secure — DROP+CREATE (return-type change: new
--    output columns, not allowed via CREATE OR REPLACE). This is the RPC
--    every public-facing ad renderer actually calls (useActivePlacements) —
--    without this, media_url/media_type/thumbnail_url never leave the
--    admin dashboard even though they're saved correctly.
DROP FUNCTION IF EXISTS public.get_active_placements_secure(text, int);
CREATE FUNCTION public.get_active_placements_secure(_placement text, _limit int DEFAULT 5)
RETURNS TABLE (
  id uuid, placement text, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  restaurant_cover_url text, restaurant_cuisine text, restaurant_rating numeric,
  restaurant_avg_prep_time int, restaurant_delivery_fee numeric, restaurant_address text,
  title text, image_url text, link_url text, sort_order int,
  media_type text, media_url text, thumbnail_url text, media_items jsonb, alt_text text,
  link_target text, cta_label text, description text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.id, sp.placement, sp.restaurant_id, r.name, r.slug, r.cover_url, r.cuisine,
    r.rating, r.avg_prep_time, r.delivery_fee, r.address,
    sp.title, sp.image_url, sp.link_url, sp.sort_order,
    sp.media_type, sp.media_url, sp.thumbnail_url, sp.media_items, sp.alt_text,
    sp.link_target, sp.cta_label, sp.description
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
-- 3) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260820100000', 'piblisite_required_description_and_display')
ON CONFLICT (version) DO NOTHING;

COMMIT;
