
-- Profiles: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles viewable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

REVOKE SELECT ON public.profiles FROM anon;

-- Reviews: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "reviews public read" ON public.reviews;
CREATE POLICY "reviews readable by authenticated"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (true);

REVOKE SELECT ON public.reviews FROM anon;

-- Lock down SECURITY DEFINER helper functions: remove PUBLIC/anon EXECUTE
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_primary_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated, service_role;
