-- Security hardening audit finding (2026-07-27): newsletter_subscribers
-- only had a bare `WITH CHECK (true)` INSERT policy open to anon +
-- authenticated, protected from abuse by nothing but the email UNIQUE
-- constraint -- no rate limit, and the constraint violation itself leaks
-- whether an email is already subscribed (a low-value but real
-- enumeration signal).
--
-- Reuses check_auth_rate_limit_secure (20260719090000_auth_hardening.sql),
-- the function already built for exactly this "public/pre-auth action,
-- keyed by email" shape (sign_up/sign_in/password-reset). Unlike those
-- call sites -- which check client-side before a *separate* GoTrue call
-- that has its own independent rate limiting as a backstop -- there is no
-- such backstop for a raw table insert, so the check and the write must
-- happen atomically in one SECURITY DEFINER RPC, and the direct INSERT
-- policy must be removed so the RPC can't be bypassed by calling
-- .insert() straight from the client. Same "RPC is the only write path"
-- convention already used by every other abuse-prone table in this
-- project (dispute_messages, order_chat_messages, ...).
DROP POLICY IF EXISTS "newsletter public subscribe" ON public.newsletter_subscribers;

CREATE OR REPLACE FUNCTION public.subscribe_newsletter_secure(_email text, _source text DEFAULT 'homepage')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(_email));
BEGIN
  IF v_email IS NULL OR v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Adrès imèl la pa valid';
  END IF;

  IF NOT public.check_auth_rate_limit_secure(v_email, 'newsletter_subscribe', 5, 3600) THEN
    -- user_id/role are NULL/'anon' here on purpose -- the visitor is
    -- almost always unauthenticated at this point (this form lives on the
    -- public homepage), and private.log_audit_event already allows a NULL
    -- actor (see e.g. its use from unauthenticated auth-hardening paths).
    PERFORM private.log_audit_event(
      auth.uid(), 'anon', 'newsletter.subscribe_rate_limited', jsonb_build_object('email', v_email)
    );
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan yon èdtan.' USING ERRCODE = '42901';
  END IF;

  -- Unchanged from the previous direct-insert behavior: a duplicate email
  -- still raises the plain unique_violation (23505) the frontend already
  -- catches to show "Ou deja enskri!" -- not caught/rewritten here.
  INSERT INTO public.newsletter_subscribers (email, source)
  VALUES (v_email, COALESCE(NULLIF(btrim(_source), ''), 'homepage'));
END;
$$;
REVOKE ALL ON FUNCTION public.subscribe_newsletter_secure(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_newsletter_secure(text, text) TO anon, authenticated;
