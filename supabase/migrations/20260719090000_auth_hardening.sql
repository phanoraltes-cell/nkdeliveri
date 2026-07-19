-- Security audit follow-up (2026-07-19): two remaining Moyenne findings.

-- ============================================================
-- 1) App-level rate limiting for pre-authentication flows.
-- check_rate_limit_secure() keys on auth.uid(), so it can't cover
-- sign-in/sign-up/password-reset-request — the caller isn't authenticated
-- yet. This variant keys on the (normalized) email being acted on instead,
-- reusing the same private.rate_limit_hits table with an 'auth:' key
-- prefix so its keyspace never collides with the per-user variant.
-- Anon-callable by necessity (login/signup/forgot-password are anon
-- actions), which is why it takes no actor identity beyond the email
-- itself — same tradeoff GoTrue's own rate limiting makes.
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit_secure(
  _email text,
  _action text,
  _max_hits int,
  _window_seconds int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_window timestamptz;
  v_count int;
BEGIN
  IF _email IS NULL OR length(btrim(_email)) = 0 THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF _action IS NULL OR length(btrim(_action)) = 0 THEN
    RAISE EXCEPTION 'action required';
  END IF;
  IF _max_hits IS NULL OR _max_hits <= 0 OR _window_seconds IS NULL OR _window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  v_key := 'auth:' || _action || ':' || lower(btrim(_email));
  v_window := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO private.rate_limit_hits (rl_key, window_start, hit_count)
  VALUES (v_key, v_window, 1)
  ON CONFLICT (rl_key, window_start)
  DO UPDATE SET hit_count = private.rate_limit_hits.hit_count + 1
  RETURNING hit_count INTO v_count;

  DELETE FROM private.rate_limit_hits
  WHERE rl_key = v_key AND window_start < v_window - make_interval(secs => _window_seconds * 4);

  RETURN v_count <= _max_hits;
END;
$$;

REVOKE ALL ON FUNCTION public.check_auth_rate_limit_secure(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit_secure(text, text, int, int) TO anon, authenticated;

-- ============================================================
-- 2) Permanently close the hardcoded admin-bootstrap allowlist.
-- It was already designed to self-disable once a real admin exists
-- (NOT EXISTS guard), but the allowlisted email living on in the function
-- body is unnecessary standing risk once bootstrap is done. Remove the
-- special-casing outright — handle_new_user() goes back to being a plain
-- signup handler with no privilege-granting side effect, and the
-- confirm-triggered duplicate of the same logic is dropped entirely.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_type text := COALESCE(NEW.raw_user_meta_data->>'account_type', 'customer');
  v_first_name text := NEW.raw_user_meta_data->>'first_name';
  v_last_name text := NEW.raw_user_meta_data->>'last_name';
  v_phone text := NEW.raw_user_meta_data->>'phone';
  v_address text := NEW.raw_user_meta_data->>'address';
  v_slug text;
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, avatar_url, phone, address)
  VALUES (
    NEW.id, v_first_name, v_last_name,
    NEW.raw_user_meta_data->>'avatar_url', v_phone, v_address
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_account_type = 'restaurant' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'restaurant_owner')
      ON CONFLICT DO NOTHING;
    v_slug := lower(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'restoran'), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(NEW.id::text, 1, 8);
    INSERT INTO public.restaurants (
      owner_id, name, slug, description, cuisine, phone, address, logo_url, cover_url, opening_hours, status
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'Restoran mwen'),
      v_slug,
      NEW.raw_user_meta_data->>'restaurant_description',
      NEW.raw_user_meta_data->>'restaurant_cuisine',
      v_phone,
      NEW.raw_user_meta_data->>'restaurant_address',
      NEW.raw_user_meta_data->>'restaurant_logo_url',
      NEW.raw_user_meta_data->>'restaurant_cover_url',
      COALESCE((NEW.raw_user_meta_data->'restaurant_hours')::jsonb, '{}'::jsonb),
      'pending'
    );

  ELSIF v_account_type = 'driver' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'driver')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.drivers (
      user_id, first_name, last_name, phone, address, vehicle_type, license_plate,
      id_doc_url, license_doc_url, vehicle_photo_url, status
    ) VALUES (
      NEW.id, v_first_name, v_last_name, v_phone, v_address,
      NEW.raw_user_meta_data->>'vehicle_type',
      NEW.raw_user_meta_data->>'license_plate',
      NEW.raw_user_meta_data->>'id_doc_url',
      NEW.raw_user_meta_data->>'license_doc_url',
      NEW.raw_user_meta_data->>'vehicle_photo_url',
      'pending'
    );

  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer')
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_admin_on_confirm();
