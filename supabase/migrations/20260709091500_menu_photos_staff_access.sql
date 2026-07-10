-- menu-photos INSERT/UPDATE/DELETE policies checked owner_id = auth.uid()
-- directly against the path's restaurant_id — staff (restaurant_employees,
-- just wired up in 20260709090000) would be blocked from uploading dish
-- photos even though they now have Meni access via the RPCs.
DROP POLICY IF EXISTS "menu_photos_owner_insert" ON storage.objects;
CREATE POLICY "menu_photos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
DROP POLICY IF EXISTS "menu_photos_owner_update" ON storage.objects;
CREATE POLICY "menu_photos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
DROP POLICY IF EXISTS "menu_photos_owner_delete" ON storage.objects;
CREATE POLICY "menu_photos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
