-- Security hardening audit finding (2026-07-27): dispute-attachments and
-- payout-proofs are the only two document buckets still missing
-- image/heic and image/heif from allowed_mime_types, even though the
-- client already allows them for both (src/lib/file-validation.ts's
-- DOCUMENT_MIME_TYPES, shared by every document-style bucket). driver-
-- documents, payment-proofs, and order-chat-attachments already accept
-- both live (added in earlier migrations) — this brings the remaining
-- two in line, so an iPhone user attaching a dispute photo or a payout
-- proof straight from their camera roll no longer passes client
-- validation only to be rejected by storage.
--
-- Only allowed_mime_types changes. file_size_limit, RLS policies, and
-- every other bucket property are untouched.
UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
WHERE id = 'dispute-attachments';

UPDATE storage.buckets SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
WHERE id = 'payout-proofs';
