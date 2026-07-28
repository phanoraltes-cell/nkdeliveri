-- "Sessions actives" feature (session-management hardening phase). Reads
-- and revokes rows directly in Supabase Auth's own auth.sessions table --
-- deliberately not a parallel session-tracking system. auth.sessions
-- already carries user_agent/ip/created_at/refreshed_at/not_after per
-- session (confirmed live on this project before writing this migration),
-- and the `postgres` role already has SELECT/DELETE on it (Supabase grants
-- this by default for exactly this kind of admin/self-service RPC).
--
-- Revocation is a straight DELETE from auth.sessions, not a call to the
-- GoTrue Admin REST API -- this project has no service-role key available
-- to a browser client, and a SECURITY DEFINER Postgres function is the
-- standard way self-service "manage my devices" features are built
-- against Supabase without one. GoTrue's refresh-token grant handler
-- looks up the session row by id; deleting it makes every refresh token
-- tied to that session invalid on its very next use, and any live
-- postgrest/realtime call already holding just the (short-lived) access
-- token keeps working only until that token's own exp -- the same
-- behavior a real "revoke" everywhere else on the web has.

-- 1) List my own sessions, newest activity first. `is_current` is derived
-- by comparing against the session_id claim GoTrue puts in every access
-- token (auth.jwt() is the standard helper for reading it) -- never
-- trust a client-supplied "this is my current session" flag.
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
    s.ip::text,
    s.id = COALESCE(NULLIF(auth.jwt() ->> 'session_id', ''), '00000000-0000-0000-0000-000000000000')::uuid
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY COALESCE(s.refreshed_at, s.created_at) DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_active_sessions_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_sessions_secure() TO authenticated;

-- 2) Revoke exactly one of my own sessions (may be the current one --
-- that's just "sign this device out", same as the existing sign-out
-- button already does client-side).
CREATE OR REPLACE FUNCTION public.revoke_my_session_secure(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.sessions WHERE id = _session_id AND user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_my_session_secure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_session_secure(uuid) TO authenticated;

-- 3) Revoke every session except the one making this call -- "log out all
-- other devices". Returns how many were actually revoked, for the toast.
CREATE OR REPLACE FUNCTION public.revoke_my_other_sessions_secure()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current uuid := COALESCE(NULLIF(auth.jwt() ->> 'session_id', ''), '00000000-0000-0000-0000-000000000000')::uuid;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = auth.uid() AND id <> v_current;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_my_other_sessions_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_other_sessions_secure() TO authenticated;
