-- Piblisite refonte, Étape 2 — extends the EXISTING `sponsored_placements`
-- table (not a new `ads` table: verified during inspection that this is
-- the real table 4 renderer components already read from
-- (ad-banner-section.tsx, sponsored-section.tsx, dashboard-ad-card.tsx,
-- restaurants.index.tsx) — creating a parallel `ads` table would either
-- duplicate the whole feature or require rewriting all 4 for no reason).
-- Règ A5-style caution: touches an admin-facing feature, not payments/
-- orders — reviewed and tested (BEGIN...ROLLBACK) before any production
-- application, never applied without explicit authorization.
--
-- Backward compatibility is load-bearing here, not just a nice-to-have:
-- Step 5 (the 4 display components) hasn't shipped yet at the point this
-- migration lands, so every write path in this same migration keeps
-- `image_url` in sync with the new `media_url` — the existing renderers
-- must keep working unmodified between Step 2 and Step 5.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean);
--   DROP FUNCTION IF EXISTS public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text);
--   -- Re-apply the immediately-prior CREATE of both verbatim
--   -- (20260722220000_sponsored_placements.sql:98-177).
--   DROP FUNCTION IF EXISTS public.log_ad_event_secure(uuid, text, text, text);
--   DROP TABLE IF EXISTS public.sponsored_placement_events;
--   ALTER TABLE public.sponsored_placements
--     DROP COLUMN IF EXISTS media_type,
--     DROP COLUMN IF EXISTS media_url,
--     DROP COLUMN IF EXISTS media_path,
--     DROP COLUMN IF EXISTS thumbnail_url,
--     DROP COLUMN IF EXISTS media_items,
--     DROP COLUMN IF EXISTS alt_text,
--     DROP COLUMN IF EXISTS link_target,
--     DROP COLUMN IF EXISTS cta_label,
--     DROP COLUMN IF EXISTS description,
--     DROP COLUMN IF EXISTS impressions,
--     DROP COLUMN IF EXISTS clicks;
--   -- Storage bucket/policies left in place on rollback (dropping a bucket
--   -- that may already hold real uploaded files is a separate, explicit
--   -- decision — never bundled into an automatic rollback).
--
-- Wrapped in BEGIN...COMMIT (A11 lesson from this project's own history):
-- the DROP FUNCTION + CREATE FUNCTION pairs below must never leave a real
-- window where the admin ads page's own RPCs don't exist.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema additions. media_url/image_url are kept in sync by the RPCs
--    below (§5), not by a trigger — every write already goes through them,
--    a trigger would be a second source of truth for the same rule.
ALTER TABLE public.sponsored_placements
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image'
    CHECK (media_type IN ('image', 'video', 'carousel', 'none')),
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS media_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alt_text text,
  ADD COLUMN IF NOT EXISTS link_target text NOT NULL DEFAULT 'new_tab'
    CHECK (link_target IN ('same_tab', 'new_tab', 'in_app')),
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS impressions bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks bigint NOT NULL DEFAULT 0;
-- link_url and updated_at (+ its trigger) already existed before this
-- migration — nothing to add for either.

COMMENT ON COLUMN public.sponsored_placements.media_url IS
  'Piblisite refonte: primary media (image or video) public URL. Kept in sync with the legacy image_url column by the create/update RPCs.';
COMMENT ON COLUMN public.sponsored_placements.media_path IS
  'Storage object path (ads-media bucket) for the primary media, so it can be deleted on edit/delete — NULL for externally-linked (non-uploaded) media_url values.';

-- ---------------------------------------------------------------------------
-- 2) Data migration: backfill media_url/media_type for every existing row
--    that already has a real image_url. image_url itself is untouched —
--    old rows, and any code not yet updated to read media_url, keep working.
UPDATE public.sponsored_placements
SET media_url = image_url, media_type = 'image'
WHERE image_url IS NOT NULL AND btrim(image_url) <> '' AND media_url IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Detailed event log. Locked down like every other table in this
--    project: no direct GRANT to anon/authenticated at all — every write
--    goes through log_ad_event_secure() (§4), which is SECURITY DEFINER
--    and therefore bypasses RLS on the INSERT regardless of the calling
--    role. RLS below only ever matters for the SELECT policy.
CREATE TABLE public.sponsored_placement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.sponsored_placements(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('impression', 'click')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsored_placement_events_lookup_idx
  ON public.sponsored_placement_events (placement_id, event_type, created_at);

ALTER TABLE public.sponsored_placement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsored_placement_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sponsored_placement_events TO authenticated; -- narrowed by the policy below
GRANT ALL ON public.sponsored_placement_events TO service_role;

CREATE POLICY "ad events read admin" ON public.sponsored_placement_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------------
-- 4) log_ad_event_secure — combines "insert the detailed event" and
--    "atomically bump the aggregate counter" into ONE call (architecture
--    decision, see the commit/report: the brief's own separate
--    increment_ad_metric() would let the events table and the aggregate
--    counters drift apart if a caller's two round-trips didn't both land).
--    Open to anon too — an impression/click can legitimately come from a
--    signed-out visitor browsing the home page.
CREATE OR REPLACE FUNCTION public.log_ad_event_secure(
  _placement_id uuid,
  _event_type text,
  _session_id text DEFAULT NULL,
  _platform text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _event_type NOT IN ('impression', 'click') THEN
    RAISE EXCEPTION 'event_type envalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sponsored_placements WHERE id = _placement_id) THEN
    RAISE EXCEPTION 'Anons pa jwenn';
  END IF;

  INSERT INTO public.sponsored_placement_events
    (placement_id, event_type, user_id, session_id, platform)
  VALUES
    (_placement_id, _event_type, auth.uid(), _session_id, _platform);

  IF _event_type = 'impression' THEN
    UPDATE public.sponsored_placements SET impressions = impressions + 1 WHERE id = _placement_id;
  ELSE
    UPDATE public.sponsored_placements SET clicks = clicks + 1 WHERE id = _placement_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.log_ad_event_secure(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_ad_event_secure(uuid, text, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) create/update_sponsored_placement_secure — DROP+CREATE (signature
--    changes; CREATE OR REPLACE alone would add a second overload instead
--    of replacing, per this project's own documented lesson —
--    20260709070000_fix_menu_overload_and_commission_admin.sql). Every new
--    param has a DEFAULT so no existing caller breaks. image_url and
--    media_url are written from whichever one the caller actually
--    provided, keeping both populated regardless of which the frontend
--    ends up using after Step 5 ships.
DROP FUNCTION IF EXISTS public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int);
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
    _description, _is_active
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int);
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
    link_target = _link_target, cta_label = _cta_label, description = _description
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Storage — ads-media bucket. Public read (banners are public content);
--    write restricted to admin/super_admin only, enforced in the policies
--    themselves (not just "the frontend only shows the uploader to
--    admins" — matches this project's standing rule of never trusting a
--    client-side-only boundary).
--
--    file_size_limit is a single bucket-wide ceiling (Storage has no
--    concept of "different limits per MIME type") — set to the video
--    ceiling (50 MB) since that's the larger of the two. The tighter 5 MB
--    *image* limit is enforced in application code only
--    (src/lib/file-validation.ts, MediaUploader) — same category of
--    client-enforced-only rule this project already accepts for the
--    image/video split. Documented here explicitly, not left implicit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('ads-media', 'ads-media', true, 50 * 1024 * 1024,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
         'video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ads-media public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ads-media');

CREATE POLICY "ads-media admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ads-media'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "ads-media admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ads-media'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "ads-media admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ads-media'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- ---------------------------------------------------------------------------
-- 7) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260819130000', 'sponsored_placements_media')
ON CONFLICT (version) DO NOTHING;

COMMIT;
