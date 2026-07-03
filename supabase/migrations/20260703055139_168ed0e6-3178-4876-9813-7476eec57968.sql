
-- restaurant-assets: public read, owner+admin write
CREATE POLICY "restaurant_assets_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'restaurant-assets');
CREATE POLICY "restaurant_assets_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'restaurant-assets' AND owner = auth.uid());
CREATE POLICY "restaurant_assets_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'restaurant-assets' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "restaurant_assets_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'restaurant-assets' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

-- user-avatars: public read, owner+admin write
CREATE POLICY "user_avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'user-avatars');
CREATE POLICY "user_avatars_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-avatars' AND owner = auth.uid());
CREATE POLICY "user_avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-avatars' AND owner = auth.uid());
CREATE POLICY "user_avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-avatars' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

-- driver-documents: private — owner + admin only
CREATE POLICY "driver_docs_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "driver_docs_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents' AND owner = auth.uid());
CREATE POLICY "driver_docs_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "driver_docs_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));
