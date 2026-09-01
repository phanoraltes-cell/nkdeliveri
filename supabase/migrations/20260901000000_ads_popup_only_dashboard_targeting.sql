-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 2 : gade sèlman
-- tip "popup" pou piblisite, ak siyalman miltip pou dashboard yo.
--
-- ENVANTÈ (verifye, pa sipoze) : `sponsored_placements` DEJA gen 5 valè
-- `placement` (home_banner/search_results/restaurant_page/dashboard/popup)
-- kòm yon sèl kolòn `text` ak yon CHECK — pa 2 tab separe. Bannyè yo (4
-- premye valè) AKTIF kounye a, afiche sou 4 kote (akèy, rechèch, paj
-- restoran, dashboard livrè/restoran) — PA kòd mò. Rezoud isit la:
--
--   1) Sispann kreye nouvo bannyè (gad nan RPC create_ a) — done ki egziste
--      yo PA efase, jis mete `is_active=false` yon sèl fwa (Altes te
--      konfime chwa sa a).
--   2) Ajoute yon nouvo kolòn `dashboard_targets text[]` sou popup yo
--      espesifikman, pou aksepte plizyè kote alafwa (chwa miltip): paj
--      piblik, dashboard kliyan, dashboard restoran, dashboard livrè.
--      Defo `{'public'}` pou tout ranje ki egziste deja — sa prezève
--      egzakteman konpòtman aktyèl la (popup yo pa t janm parèt nan yon
--      dashboard, kontrent lan te yon `if (pathname.startsWith("/dashboard"))`
--      kòdyè, jodi a li vin done, men rezilta a idantik pou popup ki egziste
--      deja yo).
--
-- Retire vre KOMPONAN frontend yo (ad-banner-section.tsx, sponsored-section.
-- tsx, dashboard-ad-card.tsx) ak pwen rann yo se yon chanjman KÒD SÈLMAN,
-- fèt apre migrasyon sa a nan menm komisyon an — okenn done pa touche pou
-- sa.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Nouvo kolòn — sèlman itilize pou placement='popup', men aplike sou tab
--    la antye pou senplisite (yon CHECK, pa 2 tab).
ALTER TABLE public.sponsored_placements
  ADD COLUMN IF NOT EXISTS dashboard_targets text[] NOT NULL DEFAULT ARRAY['public']::text[];

ALTER TABLE public.sponsored_placements
  ADD CONSTRAINT sponsored_placements_dashboard_targets_valid
  CHECK (dashboard_targets <@ ARRAY['public','dashboard_customer','dashboard_restaurant','dashboard_driver']::text[]);

-- ---------------------------------------------------------------------------
-- 2) Dezaktive (pa efase) tout bannyè ki aktif jodi a — yon sèl fwa, done a
--    rete entak, sèlman `is_active` chanje.
UPDATE public.sponsored_placements
   SET is_active = false
 WHERE placement <> 'popup' AND is_active = true;

-- ---------------------------------------------------------------------------
-- 3) create_sponsored_placement_secure — 1 nouvo paramèt trailing chanje
--    siyati a (20→21 paramèt) — Postgres kreye yon SIWOSHAJ san yon DROP
--    eksplisit anvan (verifye pa `npm run check:migrations`, ki te fè m
--    kwè sa te "san danje" pou tout ka anba a mande yon DROP kanmenm).
DROP FUNCTION IF EXISTS public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean, int, int);
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
  _is_active boolean DEFAULT true,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL,
  _dashboard_targets text[] DEFAULT ARRAY['public']::text[]
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
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- Tach 2 (piblisite) — sèlman popup ka kreye kounye a. Bannyè ki egziste
  -- deja yo (4 lòt valè placement) rete li/edite (update_ pa gen paramèt
  -- _placement, yo pa ka janm chanje), sèlman kreyasyon nouvo bloke.
  IF _placement <> 'popup' THEN
    RAISE EXCEPTION 'Sèlman anons tip "popup" ka kreye kounye a — bannyè pa disponib ankò pou nouvo anons';
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
  IF NOT (_dashboard_targets <@ ARRAY['public','dashboard_customer','dashboard_restaurant','dashboard_driver']::text[]) THEN
    RAISE EXCEPTION 'Kote afichaj envalid';
  END IF;
  IF array_length(_dashboard_targets, 1) IS NULL THEN
    RAISE EXCEPTION 'Chwazi omwen yon kote pou popup la parèt';
  END IF;

  INSERT INTO public.sponsored_placements (
    placement, restaurant_id, title, image_url, link_url, starts_at, ends_at, sort_order, created_by,
    media_type, media_url, media_path, thumbnail_url, media_items, alt_text, link_target, cta_label,
    description, is_active, media_width, media_height, dashboard_targets
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active, _media_width, _media_height, _dashboard_targets
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;
-- DROP FUNCTION pi wo a efase ansyen grants yo tou — remete yo eksplisitman
-- (idantik ak sa ki te la anvan, wè 20260819130000_sponsored_placements_media.sql:157-289).
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean, int, int, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean, int, int, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) update_sponsored_placement_secure — menm apwòch, 1 nouvo paramèt
--    trailing, DROP eksplisit obligatwa (menm rezon ak pi wo a).
DROP FUNCTION IF EXISTS public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text, int, int);
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
  _description text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL,
  _dashboard_targets text[] DEFAULT ARRAY['public']::text[]
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
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
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
  IF NOT (_dashboard_targets <@ ARRAY['public','dashboard_customer','dashboard_restaurant','dashboard_driver']::text[]) THEN
    RAISE EXCEPTION 'Kote afichaj envalid';
  END IF;
  IF array_length(_dashboard_targets, 1) IS NULL THEN
    RAISE EXCEPTION 'Chwazi omwen yon kote pou popup la parèt';
  END IF;

  UPDATE public.sponsored_placements SET
    title = btrim(_title), image_url = v_media_url, link_url = _link_url,
    starts_at = _starts_at, ends_at = _ends_at, is_active = _is_active, sort_order = _sort_order,
    media_type = _media_type, media_url = v_media_url, media_path = _media_path,
    thumbnail_url = _thumbnail_url, media_items = _media_items, alt_text = _alt_text,
    link_target = _link_target, cta_label = _cta_label, description = btrim(_description),
    media_width = _media_width, media_height = _media_height, dashboard_targets = _dashboard_targets
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text, int, int, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text, int, int, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) get_active_placements_secure — nouvo paramèt trailing `_context text
--    DEFAULT NULL`. Lè bay, filtre anplis sou `dashboard_targets` (sèlman
--    afekte popup an pratik, paske se sèl kote kolòn nan gen plizyè valè
--    posib — lòt placement yo toujou gen defo `{'public'}`, kidonk yon
--    `_context='public'` pa chanje anyen pou yo). DROP eksplisit obligatwa
--    (menm rezon ak fonksyon yo pi wo a).
DROP FUNCTION IF EXISTS public.get_active_placements_secure(text, int);
CREATE OR REPLACE FUNCTION public.get_active_placements_secure(
  _placement text,
  _limit int DEFAULT 5,
  _context text DEFAULT NULL
)
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
    AND (_context IS NULL OR _context = ANY(sp.dashboard_targets))
  ORDER BY sp.sort_order ASC, sp.created_at DESC
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.get_active_placements_secure(text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_placements_secure(text, int, text) TO anon, authenticated;

COMMIT;
