-- Hotfix part 2: 20260703200500 revoked `anon`'s EXECUTE on public.has_role,
-- treating it as a stray grant. It wasn't stray — public RLS policies (e.g.
-- "Approved restaurants viewable by all") call public.has_role(auth.uid(), ...)
-- as part of their OR chain, and that call happens as whichever role is
-- querying, including `anon` for logged-out visitors. Revoking EXECUTE there
-- broke all anonymous browsing (homepage, restaurant list, menu).
--
-- This is safe to re-grant: public.has_role already short-circuits to false
-- for anon (auth.uid() IS NULL, added in 20260704160000) before ever touching
-- private.has_role, and still blocks authenticated non-admins from probing
-- another user's role. Only the ability to execute the outer wrapper was
-- missing — not a re-opening of the original probing issue.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO anon;
