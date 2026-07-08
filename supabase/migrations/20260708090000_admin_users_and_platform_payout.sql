-- 1) Admin-wide user directory (all roles, not just customers) for the new
--    "Jere itilizatè" admin page. Mirrors get_customers_admin's shape/security
--    but without the role filter, plus an aggregated roles array.
CREATE OR REPLACE FUNCTION public.get_all_users_admin(_search text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  roles text[]
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
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[])
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.created_at
  ORDER BY p.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_all_users_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin(text) TO authenticated;

-- 2) Platform-level MonCash/NatCash fallback numbers, replacing the
--    hardcoded ADMIN_PAYOUT constant in src/lib/admin-payout.ts. Used at
--    checkout whenever a restaurant hasn't configured its own direct
--    payout (restaurant_payout_details.payout_mode <> 'direct').
--    Singleton row: boolean PK + CHECK(id) makes a second row impossible.
CREATE TABLE public.platform_payout_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_payout_settings (id, moncash_number, moncash_account_name, natcash_number, natcash_account_name)
VALUES (true, '+509 4741-9458', 'Jasline Phanor', '+509 4167-8490', 'Jasline Phanor');

ALTER TABLE public.platform_payout_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.platform_payout_settings TO authenticated;
GRANT ALL ON public.platform_payout_settings TO service_role;

-- No direct SELECT/UPDATE policy for plain `authenticated`: reads go through
-- get_platform_payout_public() (safe to expose — same shape as what was
-- previously a public hardcoded constant shipped in the client bundle),
-- writes go through update_platform_payout_settings_secure() (admin-only).
CREATE POLICY "Admins can view platform payout settings"
  ON public.platform_payout_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.get_platform_payout_public()
RETURNS TABLE (
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
  FROM public.platform_payout_settings WHERE id = true;
$$;
REVOKE ALL ON FUNCTION public.get_platform_payout_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_payout_public() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.update_platform_payout_settings_secure(
  _moncash_number text,
  _moncash_account_name text,
  _natcash_number text,
  _natcash_account_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.platform_payout_settings
  SET moncash_number = _moncash_number,
      moncash_account_name = _moncash_account_name,
      natcash_number = _natcash_number,
      natcash_account_name = _natcash_account_name,
      updated_at = now()
  WHERE id = true;
END;
$$;
REVOKE ALL ON FUNCTION public.update_platform_payout_settings_secure(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_platform_payout_settings_secure(text, text, text, text) TO authenticated;
