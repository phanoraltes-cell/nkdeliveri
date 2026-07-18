-- Customers/drivers photographing a payment proof or ID document directly
-- with an iPhone camera get a HEIC/HEIF file by default, which the buckets'
-- allowed_mime_types (set in 20260713120000_secure_storage_buckets.sql) did
-- not include — the upload was silently rejected by Storage regardless of
-- what the client-side check said. Widen all five image-accepting buckets
-- to match the updated src/lib/file-validation.ts IMAGE_MIME_TYPES, keeping
-- both in sync per that migration's own comment.

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'menu-photos';

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'restaurant-assets';

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'avatars';

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
WHERE id = 'driver-documents';

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
WHERE id = 'payment-proofs';
