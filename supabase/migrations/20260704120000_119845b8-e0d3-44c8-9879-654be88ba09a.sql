-- Restaurant dashboard: schema additions (soft-delete for products, promotions,
-- menu photo storage bucket). Every statement is idempotent (safe to re-run)
-- because a prior partial application of this exact file left the target
-- database in a mixed state.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  code text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS idx_promotions_restaurant ON public.promotions(restaurant_id);
DROP TRIGGER IF EXISTS trg_promotions_upd ON public.promotions;
CREATE TRIGGER trg_promotions_upd BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
-- Reads: public sees only active promos of approved restaurants; owner/admin see all of their own.
GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT ALL ON public.promotions TO service_role;
DROP POLICY IF EXISTS "promotions public read" ON public.promotions;
CREATE POLICY "promotions public read" ON public.promotions FOR SELECT
  USING (
    (active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
      AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.status = 'approved'))
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id
               AND (r.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')))
  );
-- No direct INSERT/UPDATE/DELETE grant for authenticated — all writes go through
-- the *_promotion_secure RPCs added in the next migration.

-- menu-photos: public read (customers need to see dish photos), owner-scoped
-- write, path convention <restaurant_id>/<filename>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-photos', 'menu-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "menu_photos_public_read" ON storage.objects;
CREATE POLICY "menu_photos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-photos');
DROP POLICY IF EXISTS "menu_photos_owner_insert" ON storage.objects;
CREATE POLICY "menu_photos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1] AND r.owner_id = auth.uid())
  );
DROP POLICY IF EXISTS "menu_photos_owner_update" ON storage.objects;
CREATE POLICY "menu_photos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND (r.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
DROP POLICY IF EXISTS "menu_photos_owner_delete" ON storage.objects;
CREATE POLICY "menu_photos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND EXISTS (SELECT 1 FROM public.restaurants r
                WHERE r.id::text = (storage.foldername(name))[1]
                  AND (r.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  );
