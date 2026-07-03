
-- 1) Move security-definer helpers to a private schema so they aren't exposed via the Data API.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.get_primary_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role::text
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'restaurant_owner' THEN 3
    WHEN 'restaurant_staff' THEN 4
    WHEN 'driver' THEN 5
    WHEN 'customer' THEN 6
    ELSE 7 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_primary_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_primary_role(uuid) TO authenticated, service_role;

-- 2) Convert the public wrappers to SECURITY INVOKER so the Data API cannot be tricked into
--    executing a definer-privileged function; the wrappers just delegate to the private helpers.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.has_role(_user_id, _role);
$$;

CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.get_primary_role(_user_id);
$$;

-- 3) Revoke PUBLIC execute on the trigger-only definer function (only the trigger needs it).
REVOKE EXECUTE ON FUNCTION public.on_payment_paid_confirm_order() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_payment_paid_confirm_order() FROM anon, authenticated;

-- 4) Lock down profiles: only the owner (and admins) can read profile PII.
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Users view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

-- 5) Scope reviews reads to relevant parties (author, reviewed restaurant owner,
--    reviewed driver, or admins) instead of every signed-in user.
DROP POLICY IF EXISTS "reviews readable by authenticated" ON public.reviews;
CREATE POLICY "reviews readable to relevant parties"
ON public.reviews
FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = reviews.restaurant_id AND r.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = reviews.driver_id AND d.user_id = auth.uid()
  )
);
