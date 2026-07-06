-- Functional audit fix: the driver-documents and restaurant-assets storage
-- policies only ever checked has_role(..., 'admin'), unlike every other
-- admin-gated policy/RPC in this project (get_primary_role, payment-proofs,
-- update_restaurant_status_secure, etc.), which all check 'admin' OR
-- 'super_admin'. A super_admin-only account (no separate 'admin' row) could
-- not view a pending driver's ID/license/vehicle photo, nor moderate a
-- restaurant's logo/cover — directly blocking the admin document review
-- feature for that role.

DROP POLICY IF EXISTS "driver_docs_owner_select" ON storage.objects;
CREATE POLICY "driver_docs_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "driver_docs_owner_update" ON storage.objects;
CREATE POLICY "driver_docs_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "driver_docs_owner_delete" ON storage.objects;
CREATE POLICY "driver_docs_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "restaurant_assets_owner_update" ON storage.objects;
CREATE POLICY "restaurant_assets_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'restaurant-assets' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));

DROP POLICY IF EXISTS "restaurant_assets_owner_delete" ON storage.objects;
CREATE POLICY "restaurant_assets_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'restaurant-assets' AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ));
