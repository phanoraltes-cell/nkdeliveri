-- Hotfix: public.has_role/get_primary_role broke anonymous (public) browsing.
-- RLS policies like "Approved restaurants viewable by all" call
-- public.has_role(auth.uid(), 'admin') as part of an OR chain. For an
-- anonymous visitor auth.uid() is NULL, so the self-or-admin guard added in
-- 20260703200500 fell through to calling private.has_role(NULL, ...), which
-- `anon` has no EXECUTE grant for — erroring the entire query instead of
-- just evaluating to false. Anonymous callers can never legitimately hold
-- any role, so short-circuit to false before ever touching the private schema.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF _user_id <> auth.uid() AND NOT private.has_role(auth.uid(), 'admin')
     AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN private.has_role(_user_id, _role);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF _user_id <> auth.uid() AND NOT private.has_role(auth.uid(), 'admin')
     AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN private.get_primary_role(_user_id);
END;
$$;
