-- PROMPT MODIFIKASYON (10 TACH) — Tach 8, Objektif B: paj piblik pwofil
-- restoran ak deskripsyon/foto ekip/videyo plat.
--
-- ENVANTÈ (Objektif A, fèmti otomatik sou orè ouvèti):
-- `public.is_restaurant_open()` (20260821100000) DEJA fè sa antyèman —
-- verifye status='approved' + Tach 1 is_open + orè ouvèti (jou/lè, fizo
-- 'America/Port-au-Prince', sipò minwi) san okenn aksyon manyèl. ZEWO
-- travay SQL nesesè pou Objektif A — se deja fèt.
--
-- Objektif B: `restaurants.description` DEJA egziste (kolòn + RPC + fòm
-- admin/pwopriyetè) men li pa t JANM afiche sou paj piblik la
-- (restaurants.$slug.tsx) — sèlman itilize pou meta SEO. Sa a se yon
-- chanjman FRONTEND sèlman. "Foto ekip" ak "videyo plat" se de NOUVO chan
-- medya — ajoute isit la.
--
-- Bucket separe pou videyo (restaurant-videos), pa restaurant-assets:
-- restaurant-assets deja gen yon limit 5MB/imaj-sèlman (20260713120000)
-- aplike NAN MOTÈ Storage a — yon videyo pa ka janm rantre ladan, e
-- elaji bucket sa a pou aksepte videyo ta lage limit 5MB imaj la tou
-- (yon sèl `file_size_limit` pou tout bucket la). Menm rezon egzat ki te
-- fè ads-media split an de bucket (imaj/videyo) nan
-- 20260827140000_split_ads_media_bucket_by_size.sql — swiv menm patwon.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) restaurants.team_photos / dish_video_url. team_photos se yon jsonb
--    tablo (senp lis URL tèks) — DEFAULT '[]' pou pa gen NULL pou jere
--    nan frontend. dish_video_url nullable, jamè backfill.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS team_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dish_video_url text;

-- ---------------------------------------------------------------------------
-- 2) Bucket restaurant-videos — menm konvansyon egzat ak menu-photos
--    (public read, owner/admin write, chemen <restaurant_id>/<fichye>).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('restaurant-videos', 'restaurant-videos', true, 50 * 1024 * 1024,
        ARRAY['video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "restaurant_videos_public_read" ON storage.objects;
CREATE POLICY "restaurant_videos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'restaurant-videos');
DROP POLICY IF EXISTS "restaurant_videos_owner_insert" ON storage.objects;
CREATE POLICY "restaurant_videos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'restaurant-videos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1] AND r.owner_id = auth.uid())
  );
DROP POLICY IF EXISTS "restaurant_videos_owner_update" ON storage.objects;
CREATE POLICY "restaurant_videos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'restaurant-videos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND (r.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
DROP POLICY IF EXISTS "restaurant_videos_owner_delete" ON storage.objects;
CREATE POLICY "restaurant_videos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'restaurant-videos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND (r.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );

-- ---------------------------------------------------------------------------
-- 3) update_restaurant_profile_secure — DROP+CREATE (siyati chanje: 2
--    nouvo paramèt trailing). Menm konvansyon COALESCE(nouvo, ansyen) ak
--    logo_url/cover_url deja etabli — NULL vle di "pa touche", pa "efase".
--    team_photos aksepte '[]'::jsonb eksplisit pou vide lis la (diferan
--    de NULL, ki vle di "pa touche").
DROP FUNCTION IF EXISTS public.update_restaurant_profile_secure(uuid, text, text, text, text, text, text, text);
CREATE FUNCTION public.update_restaurant_profile_secure(
  _restaurant_id uuid, _name text, _description text, _cuisine text,
  _phone text, _address text, _logo_url text, _cover_url text,
  _team_photos jsonb DEFAULT NULL, _dish_video_url text DEFAULT NULL
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurants;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Restaurant name is required';
  END IF;
  UPDATE public.restaurants SET
    name = btrim(_name), description = _description, cuisine = _cuisine, phone = _phone,
    address = _address,
    logo_url = COALESCE(_logo_url, logo_url),
    cover_url = COALESCE(_cover_url, cover_url),
    team_photos = COALESCE(_team_photos, team_photos),
    dish_video_url = COALESCE(_dish_video_url, dish_video_url)
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_restaurant_profile_secure(uuid, text, text, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_restaurant_profile_secure(uuid, text, text, text, text, text, text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260830090000', 'restaurant_public_profile_media')
ON CONFLICT (version) DO NOTHING;

COMMIT;
