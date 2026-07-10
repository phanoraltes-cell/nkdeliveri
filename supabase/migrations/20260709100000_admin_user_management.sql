-- "Jere itilizatè" (admin/users) was a pure read-only directory: search,
-- filter, CSV export all worked, but there was zero useMutation, zero write
-- RPC anywhere — a page titled "Manage users" that could not manage
-- anything. Add the two actions the user asked for: role change and
-- suspend/reactivate.

-- ---------------------------------------------------------------------------
-- 1) get_all_users_admin: add banned_until so the UI can show suspend state.
--    The OUT-parameter row type is changing, so CREATE OR REPLACE alone
--    can't do it — Postgres requires the old signature dropped first.
DROP FUNCTION IF EXISTS public.get_all_users_admin(text);
CREATE OR REPLACE FUNCTION public.get_all_users_admin(_search text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  roles text[],
  banned_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.created_at,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]),
    u.banned_until
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.created_at, u.banned_until
  ORDER BY p.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Role management. Granting/revoking admin/super_admin is restricted to
--    super_admin — a plain admin managing roles could otherwise elevate
--    themselves or anyone else straight to admin.
CREATE OR REPLACE FUNCTION public.add_user_role_secure(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _role IN ('admin', 'super_admin') AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Sèl yon super_admin ka bay wòl admin' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.add_user_role_secure(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_user_role_secure(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_user_role_secure(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _role IN ('admin', 'super_admin') AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Sèl yon super_admin ka retire wòl admin' USING ERRCODE = '42501';
  END IF;
  IF _user_id = auth.uid() AND _role IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Ou pa ka retire pwòp wòl admin ou';
  END IF;
  IF _role = 'super_admin' AND (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'Dwe gen omwen yon super_admin sou platfòm nan';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_user_role_secure(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_user_role_secure(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.get_all_users_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin(text) TO authenticated;
