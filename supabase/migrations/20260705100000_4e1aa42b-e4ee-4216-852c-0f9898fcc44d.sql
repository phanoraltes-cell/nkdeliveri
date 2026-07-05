-- Newsletter subscribers (the homepage form was 100% decorative — it only
-- ever called e.preventDefault() and showed a toast; nothing was ever saved
-- anywhere) + an admin-only customer directory RPC for the "track customers /
-- export" dashboard feature.

CREATE TABLE public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  source text NOT NULL DEFAULT 'homepage'
);
CREATE INDEX idx_newsletter_active ON public.newsletter_subscribers(subscribed_at) WHERE unsubscribed_at IS NULL;

GRANT INSERT ON public.newsletter_subscribers TO anon, authenticated;
GRANT SELECT, UPDATE ON public.newsletter_subscribers TO authenticated;
GRANT ALL ON public.newsletter_subscribers TO service_role;
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone (including logged-out visitors) can subscribe. No SELECT grant for
-- anon/authenticated at all — a subscriber list is only ever admin-readable,
-- matching how profiles/reviews PII is scoped elsewhere in this project.
CREATE POLICY "newsletter public subscribe" ON public.newsletter_subscribers
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "newsletter admin read" ON public.newsletter_subscribers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "newsletter admin update" ON public.newsletter_subscribers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Customer directory for the admin dashboard: profiles has no email column
-- (it lives on auth.users, which the Data API never exposes directly), and
-- there's no legitimate reason for a client-side join here — this is
-- explicitly an admin-only report, so a SECURITY DEFINER RPC is the right
-- shape rather than trying to widen RLS on auth.users.
CREATE OR REPLACE FUNCTION public.get_customers_admin(_search text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  address text,
  created_at timestamptz,
  total_orders bigint,
  total_spent numeric
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
    p.address,
    p.created_at,
    COUNT(o.id)::bigint,
    COALESCE(SUM(o.total) FILTER (WHERE o.status = 'delivered'), 0)
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'customer'
  LEFT JOIN public.orders o ON o.customer_id = p.id
  WHERE _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.address, p.created_at
  ORDER BY p.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customers_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_admin(text) TO authenticated;
