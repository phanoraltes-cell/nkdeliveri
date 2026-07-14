-- Security remediation (Phase 1, item 2): no storage.buckets row anywhere in
-- the prior history ever set file_size_limit/allowed_mime_types, so every
-- authenticated upload to menu-photos, restaurant-assets, avatars,
-- driver-documents and payment-proofs was unbounded in size and type once
-- past the one-shot signup gate in finalizeRegistrationDocuments (which has
-- always enforced its own 8MB/allowlist check in application code). This
-- moves the same limits to the storage engine itself, where they apply to
-- every write path (client-side uploads included), not just that one
-- server function.
--
-- Limits mirror src/lib/file-validation.ts (UPLOAD_LIMITS) — keep both in
-- sync if either changes.

UPDATE storage.buckets SET
  file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'menu-photos';

UPDATE storage.buckets SET
  file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'restaurant-assets';

UPDATE storage.buckets SET
  file_size_limit = 3 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'avatars';

UPDATE storage.buckets SET
  file_size_limit = 8 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'driver-documents';

UPDATE storage.buckets SET
  file_size_limit = 8 * 1024 * 1024,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'payment-proofs';
