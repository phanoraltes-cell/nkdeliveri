-- PROMPT MODIFIKASYON (10 TACH) — Tach 4: jesyon piblisite (tit/deskripsyon/
-- imaj) + koreksyon afichaj imaj (object-fit: contain, jamè koupe, kontenè
-- ki gen rapò dimansyon dinamik).
--
-- ENVANTÈ (Piblisite refonte, migrasyon 20260819130000/20260820100000, deja
-- fèt AVAN pwomt sa a): `sponsored_placements` DEJA gen `title`,
-- `description` (obligatwa) ak medya (`media_url`/`image_url`) — fòm admin
-- lan (dashboard.admin.ads.tsx) deja gen 3 chan sa yo, validasyon ladan yo,
-- ak preview. AUKENN nouvo chan tit/deskripsyon/imaj nesesè.
--
-- SÈL bagay ki manke reyèlman se egzakteman sa demand lan mande apre sa:
-- CHAK andwa ki afiche medya yon anons (ad-banner-section.tsx,
-- sponsored-section.tsx, ak preview admin lan) itilize yon kontenè AK YON
-- RAPÒ DIMANSYON FIKS (`aspect-[16/9]`, `aspect-[23/15]`, `h-[150px]`) +
-- `object-cover` — sa vle di NENPÒT imaj ki pa gen egzakteman menm rapò a
-- KOUPE (pati anlè/anba oswa agoch/adwat pèdi), kèlkeswa sa admin an
-- telechaje. Migrasyon sa a ajoute `media_width`/`media_height` (mezire
-- otomatikman pa MediaUploader lè yon fichye telechaje oswa yon lyen ekstèn
-- antre) pou chak andwa ka konstwi yon kontenè AK VRE RAPÒ imaj/videyo a,
-- epi frontend chanje `object-cover` → `object-contain` toupatou (chanjman
-- frontend sèlman, pa nan migrasyon sa a).
--
-- Backfill: `media_width`/`media_height` rete NULL pou tout anons ki deja
-- egziste — pa gen mwayen "devine" dimansyon yon imaj deja telechaje san
-- rechaje l. Yo kontinye afiche ak rapò FIKS default plasman an (menm jan
-- jodi a) men ak `object-contain` olye `object-cover` — sa vle di yo
-- imedyatman sispann koupe (amelyorasyon san danje, jamè pi mal pase jodi
-- a), y ap jwenn rapò EGZAK la sèlman lè admin an re-sove/re-telechaje.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) sponsored_placements.media_width / media_height.
ALTER TABLE public.sponsored_placements
  ADD COLUMN IF NOT EXISTS media_width int,
  ADD COLUMN IF NOT EXISTS media_height int;

-- ---------------------------------------------------------------------------
-- 2) create/update_sponsored_placement_secure — DROP+CREATE (siyati chanje:
--    2 nouvo paramèt trailing), swiv menm konvansyon ak Étape 2
--    (20260819130000). Kò a idantik a vèsyon 20260820100000 la (menm
--    validasyon), sèl ajoute media_width/media_height nan INSERT/UPDATE.
DROP FUNCTION IF EXISTS public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean);
CREATE FUNCTION public.create_sponsored_placement_secure(
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
  _is_active boolean DEFAULT true,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
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
    description, is_active, media_width, media_height
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active, _media_width, _media_height
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean, int, int) TO authenticated;

DROP FUNCTION IF EXISTS public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text);
CREATE FUNCTION public.update_sponsored_placement_secure(
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
  _description text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
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
    link_target = _link_target, cta_label = _cta_label, description = btrim(_description),
    media_width = _media_width, media_height = _media_height
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) get_active_placements_secure — DROP+CREATE (2 nouvo kolòn nan retou a).
--    Menm fonksyon ak 20260820100000, sèl ajoute media_width/media_height.
DROP FUNCTION IF EXISTS public.get_active_placements_secure(text, int);
CREATE FUNCTION public.get_active_placements_secure(_placement text, _limit int DEFAULT 5)
RETURNS TABLE (
  id uuid, placement text, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  restaurant_cover_url text, restaurant_cuisine text, restaurant_rating numeric,
  restaurant_avg_prep_time int, restaurant_delivery_fee numeric, restaurant_address text,
  title text, image_url text, link_url text, sort_order int,
  media_type text, media_url text, thumbnail_url text, media_items jsonb, alt_text text,
  link_target text, cta_label text, description text, media_width int, media_height int
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
    sp.link_target, sp.cta_label, sp.description, sp.media_width, sp.media_height
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
-- 4) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829180000', 'ad_media_contain_fit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
