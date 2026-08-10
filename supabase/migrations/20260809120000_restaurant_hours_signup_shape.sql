-- Remediation of docs/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md § 8 (Root
-- Cause R1): restaurants.opening_hours was always '{}' at signup because
-- the signup form never sent a `restaurant_hours` key at all -- fixed on
-- the frontend (restaurant-form.tsx now uses the same day-by-day
-- HoursPicker as the profile editor). This migration is the matching
-- backend half: decode that value correctly and safely.
--
-- New pure validation helper, extracted conceptually from
-- update_restaurant_hours_secure's inline checks
-- (20260720100100_validate_restaurant_hours_shape.sql) but NOT sharing code
-- with it -- that RPC is already reviewed/tested and stays completely
-- untouched by this migration (smallest possible blast radius). Some
-- duplication of the validation rules is an accepted, deliberate tradeoff.
CREATE OR REPLACE FUNCTION public.is_valid_opening_hours_shape(_hours jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF _hours IS NULL OR jsonb_typeof(_hours) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(_hours) LOOP
    IF v_key NOT IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_value) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_value->'closed') IS DISTINCT FROM 'boolean' THEN
      RETURN false;
    END IF;
    IF (v_value->>'closed')::boolean IS FALSE THEN
      IF v_value->>'open' IS NULL OR v_value->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RETURN false;
      END IF;
      IF v_value->>'close' IS NULL OR v_value->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;
-- Called only from handle_new_user() (SECURITY DEFINER, runs as its owner,
-- which already has implicit EXECUTE on every function it owns) -- no
-- caller needs a direct grant, matching this project's least-privilege
-- convention from the payment-security remediation
-- (20260808210000_payment_security_least_privilege.sql).
REVOKE ALL ON FUNCTION public.is_valid_opening_hours_shape(jsonb) FROM PUBLIC;

-- handle_new_user(): identical to the currently-live version
-- (20260720100000_fix_restaurant_slug_generation.sql) except the
-- restaurant_hours line. Full body reproduced (not a partial diff) because
-- CREATE OR REPLACE requires the complete function; signature is unchanged
-- (a trigger function, no arguments), so this is a safe in-place replace,
-- not a new overload.
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
  v_hours jsonb := '{}'::jsonb;
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
    v_slug := trim(both '-' from regexp_replace(
                lower(COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'restoran')),
                '[^a-z0-9]+', '-', 'g'
              ))
              || '-' || substr(NEW.id::text, 1, 8);

    -- restaurant_hours arrives as a JSON-encoded *string* (restaurant-form.tsx
    -- sends it via the same Record<string,string> metadata contract every
    -- signup form uses), not a nested object -- decode with ->> then ::jsonb,
    -- never with the bare -> operator (which would keep an already-jsonb
    -- string value as a jsonb *scalar*, not parse it). Defensive: a
    -- malformed or foreign value here (raw_user_meta_data is fully caller-
    -- controlled at the GoTrue signup API, not just via this form) must
    -- never abort the whole account creation -- falls back to the same
    -- '{}' default this project has always had.
    BEGIN
      v_hours := COALESCE(NULLIF(NEW.raw_user_meta_data->>'restaurant_hours', '')::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_hours := '{}'::jsonb;
    END;
    IF NOT public.is_valid_opening_hours_shape(v_hours) THEN
      v_hours := '{}'::jsonb;
    END IF;

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
      v_hours,
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
