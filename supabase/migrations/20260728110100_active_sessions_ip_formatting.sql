-- Follow-up to 20260728110000: auth.sessions.ip is inet, and casting it
-- directly to text keeps the /32 CIDR suffix (confirmed live: a real
-- session's IP came back as "153.67.87.161/32") -- host() strips it to a
-- plain address, which is what the "Sessions actives" UI actually wants
-- to display. No change to the function's signature, security, or any
-- other column.
CREATE OR REPLACE FUNCTION public.get_my_active_sessions_secure()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  not_after timestamptz,
  user_agent text,
  ip text,
  is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.created_at,
    s.refreshed_at,
    s.not_after,
    s.user_agent,
    host(s.ip),
    s.id = COALESCE(NULLIF(auth.jwt() ->> 'session_id', ''), '00000000-0000-0000-0000-000000000000')::uuid
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY COALESCE(s.refreshed_at, s.created_at) DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_active_sessions_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_sessions_secure() TO authenticated;
