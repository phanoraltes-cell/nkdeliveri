-- Reviews now have a real submission/display feature — restore public
-- readability. Two earlier privacy passes (20260703063224, then 20260703070152)
-- progressively locked reviews.SELECT down to "authenticated only", then to
-- "only the author/reviewed restaurant/reviewed driver/admin" — which makes a
-- customer review system pointless, since no other customer could ever see a
-- review to inform their choice. Ratings/comments aren't sensitive PII the
-- way profiles.phone/address are; restore the original public-read intent.
DROP POLICY IF EXISTS "reviews readable to relevant parties" ON public.reviews;
DROP POLICY IF EXISTS "reviews readable by authenticated" ON public.reviews;
CREATE POLICY "reviews public read" ON public.reviews FOR SELECT USING (true);
GRANT SELECT ON public.reviews TO anon;

-- Reviews now have a real submission form (customer side) — keep
-- restaurants.rating in sync automatically instead of leaving it a static
-- seed value that never reflects actual customer reviews.
CREATE OR REPLACE FUNCTION public.sync_restaurant_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_restaurant_id uuid;
BEGIN
  v_restaurant_id := COALESCE(NEW.restaurant_id, OLD.restaurant_id);
  IF v_restaurant_id IS NOT NULL THEN
    UPDATE public.restaurants SET rating = COALESCE((
      SELECT ROUND(AVG(restaurant_rating)::numeric, 2) FROM public.reviews
      WHERE restaurant_id = v_restaurant_id AND restaurant_rating IS NOT NULL
    ), 0)
    WHERE id = v_restaurant_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_restaurant_rating ON public.reviews;
CREATE TRIGGER trg_sync_restaurant_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.sync_restaurant_rating();
