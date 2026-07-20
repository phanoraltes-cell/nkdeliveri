-- Bug: handle_new_user() built the slug by running regexp_replace() on the
-- restaurant name BEFORE lower()-casing it. Since the character class
-- '[^a-z0-9]+' only matches lowercase, every uppercase letter in the
-- (still mixed-case) name also failed the class and got replaced with a
-- dash — only afterwards did lower() run, by which point the letters were
-- already gone. A name like "Ti Manje" produced slugs like "--...", exactly
-- the garbled sitemap entries the SEO audit found live. Fix: lower() first,
-- then regexp_replace on the already-lowercased string, and trim any
-- leading/trailing dash left by a name that starts/ends with punctuation.
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
    v_slug := trim(both '-' from regexp_replace(
                lower(COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'restoran')),
                '[^a-z0-9]+', '-', 'g'
              ))
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

-- One-time backfill: repair existing garbled slugs (produced by the buggy
-- version above) for restaurants that haven't customized their slug since.
-- Only touches slugs matching the exact buggy pattern (leading/doubled
-- dashes right before the 8-char id suffix) to avoid clobbering any slug an
-- admin or restaurant owner may have deliberately edited by hand.
UPDATE public.restaurants
SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
           || '-' || substr(id::text, 1, 8)
WHERE slug ~ '(^-|--)'
  AND slug LIKE '%-' || substr(id::text, 1, 8);
