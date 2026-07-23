-- Storage bucket for optional payout proof-of-payment screenshots, mirroring
-- the existing `payment-proofs` bucket's exact conventions (see
-- 20260703063943_...sql:26-71 and 20260705120000_...sql:14-18): private
-- bucket, size/type limits matching src/lib/file-validation.ts. Uploaded by
-- the admin (not the beneficiary — it's the admin proving they sent the
-- money) BEFORE the payout row exists (the admin picks a method/uploads a
-- proof, then submits the whole form as one initiate_payout_secure call),
-- so the folder can't be keyed by payout_id like payment-proofs is keyed by
-- order_id. Path convention instead: <restaurant_id-or-driver_id>/<filename>
-- — the beneficiary's own id, always known before the payout is created.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('payout-proofs', 'payout-proofs', false, 8 * 1024 * 1024,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- The folder name is a beneficiary id but its type (restaurant vs driver)
-- isn't encoded in the path — try both interpretations via the existing
-- payout_beneficiary_visible helper, exactly one of which can ever match.
CREATE OR REPLACE FUNCTION private.payout_beneficiary_folder_visible(_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.payout_beneficiary_visible(_folder_id, NULL) OR private.payout_beneficiary_visible(NULL, _folder_id);
$$;
REVOKE ALL ON FUNCTION private.payout_beneficiary_folder_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.payout_beneficiary_folder_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS "payout proofs upload by admin" ON storage.objects;
CREATE POLICY "payout proofs upload by admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payout-proofs'
  AND (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'))
);

DROP POLICY IF EXISTS "payout proofs read by admin or beneficiary" ON storage.objects;
CREATE POLICY "payout proofs read by admin or beneficiary"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payout-proofs'
  AND (
    private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
    OR private.payout_beneficiary_folder_visible(((storage.foldername(name))[1])::uuid)
  )
);

DROP POLICY IF EXISTS "payout proofs delete by admin" ON storage.objects;
CREATE POLICY "payout proofs delete by admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'payout-proofs'
  AND (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'))
);
