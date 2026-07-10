-- Bug: 20260709091500_menu_photos_staff_access.sql wrote
-- `(storage.foldername(name))[1]` intending `name` to mean the row being
-- inserted (storage.objects.name, the file path). But inside the correlated
-- subquery `SELECT 1 FROM public.restaurants r WHERE ...`, an unqualified
-- `name` resolves to the *innermost* matching column in scope — and
-- `restaurants` itself has a `name` column (the restaurant's display name,
-- e.g. "NK FOOD") — so Postgres silently bound it to `r.name` instead of the
-- outer `storage.objects.name`. Confirmed live: `pg_policies` shows the
-- stored expression as `(storage.foldername(r.name))[1]`.
--
-- storage.foldername('NK FOOD') has no '/' to split on, so it returns an
-- empty array — `(...)[1]` is NULL — `r.id::text = NULL` is never true for
-- any restaurant, so the EXISTS subquery was always false. Every dish-photo
-- upload for every restaurant has been rejected with "new row violates
-- row-level security policy" since that migration was applied — a
-- regression introduced while wiring up staff access to menu photos.
--
-- Fix: qualify the objects table explicitly (`storage.objects.name`) so it
-- can never be shadowed by a same-named column introduced by the subquery's
-- own FROM clause, regardless of what other tables get joined in later.
DROP POLICY IF EXISTS "menu_photos_owner_insert" ON storage.objects;
CREATE POLICY "menu_photos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(storage.objects.name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
DROP POLICY IF EXISTS "menu_photos_owner_update" ON storage.objects;
CREATE POLICY "menu_photos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(storage.objects.name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
DROP POLICY IF EXISTS "menu_photos_owner_delete" ON storage.objects;
CREATE POLICY "menu_photos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(storage.objects.name))[1]
                  AND private.is_restaurant_staff_or_manager(r.id))
  );
