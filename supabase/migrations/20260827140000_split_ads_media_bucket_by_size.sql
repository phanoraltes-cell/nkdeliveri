-- Audit remediation (2026-08-27, API-001). The 'ads-media' bucket (see
-- 20260819130000_sponsored_placements_media.sql) has a single flat
-- file_size_limit of 50MB covering both images and videos — the intended
-- 5MB ceiling for images only ever existed as a client-side check
-- (src/lib/file-validation.ts's validateAdMediaFile), which a direct
-- Storage API call bypasses entirely (that file's own comment already
-- acknowledged this). This splits future uploads across two purpose-sized
-- buckets so the Storage engine itself enforces the 5MB image / 50MB video
-- distinction, matching every other document bucket in this project
-- (menu-photos, driver-documents, etc., all engine-enforced since
-- 20260713120000_secure_storage_buckets.sql).
--
-- The OLD 'ads-media' bucket is intentionally left untouched, not
-- dropped/migrated: existing sponsored_placements rows already have
-- media_url/thumbnail_url values pointing into it, and moving live
-- production files during a migration is out of scope and unnecessary —
-- the application code change (src/components/dashboard/admin/media-
-- uploader.tsx, src/routes/_authenticated/dashboard.admin.ads.tsx) derives
-- which bucket to read/delete from directly from each row's own stored
-- URL (see storage-upload.ts's new bucketFromPublicUrl()), so old and new
-- rows both keep working without a data migration or a new column.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('ads-media-images', 'ads-media-images', true, 5 * 1024 * 1024,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  ('ads-media-videos', 'ads-media-videos', true, 50 * 1024 * 1024,
   ARRAY['video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO NOTHING;

-- Same admin-only write / public-read shape as the original 'ads-media'
-- policies, duplicated per bucket (storage.objects RLS is keyed by
-- bucket_id, not something a single policy can parameterize across
-- buckets while still reading cleanly).
CREATE POLICY "ads-media-images public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ads-media-images');
CREATE POLICY "ads-media-images admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ads-media-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
CREATE POLICY "ads-media-images admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ads-media-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
CREATE POLICY "ads-media-images admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ads-media-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "ads-media-videos public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ads-media-videos');
CREATE POLICY "ads-media-videos admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ads-media-videos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
CREATE POLICY "ads-media-videos admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ads-media-videos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
CREATE POLICY "ads-media-videos admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ads-media-videos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- No manual `INSERT INTO supabase_migrations.schema_migrations` here — see
-- 20260827130000_audit_remediation_dead_grant_and_reconciliation.sql's own
-- comment on why that "Rule A11" pattern (present on several migrations
-- from 20260818140000 onward) breaks CI's local-replay validation and was
-- deliberately left out of this migration.
