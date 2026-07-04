-- Security remediation, part 2: close role-probing and payout-disclosure gaps
-- found during the full RLS/SECURITY DEFINER audit.

-- 1) public.has_role / public.get_primary_role currently let ANY authenticated
--    caller (and, worse, `anon`) query the role of an arbitrary _user_id via
--    the Data API (supabase.rpc('has_role', { _user_id: <someone-else> })).
--    Restrict the public wrappers to "self, or an admin querying anyone" —
--    every legitimate internal caller (RLS policies, send-push.functions.ts)
--    already passes auth.uid() as _user_id, so this changes no existing
--    behavior for the app itself.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
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
  IF _user_id <> auth.uid() AND NOT private.has_role(auth.uid(), 'admin')
     AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN private.get_primary_role(_user_id);
END;
$$;

-- Revoke the stray anon grant from 20260703063608 — unauthenticated visitors
-- had no business calling this at all.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

-- 2) Auto-disable the hardcoded admin-bootstrap allowlist once a real admin
--    already exists, so it stops being a standing backdoor tied to one email
--    address. Keeps working for first-run setup, closes itself afterward.
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

  -- Auto-grant admin to the allowlisted email, but only until a real admin
  -- exists — closes the standing-backdoor window after first-run setup.
  IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'phanoraltes@gmail.com'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_admin_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'phanoraltes@gmail.com'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) get_restaurant_payout_public exposed live MonCash/NatCash numbers for
--    ANY restaurant id, including restaurants still pending approval. Scope
--    it to approved restaurants (what checkout actually needs), or the
--    restaurant's own owner/admin previewing their own config.
CREATE OR REPLACE FUNCTION public.get_restaurant_payout_public(_restaurant_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  payout_mode text,
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
  SELECT d.restaurant_id, d.payout_mode, d.moncash_number, d.moncash_account_name,
         d.natcash_number, d.natcash_account_name
  FROM public.restaurant_payout_details d
  JOIN public.restaurants r ON r.id = d.restaurant_id
  WHERE d.restaurant_id = _restaurant_id
    AND (
      r.status = 'approved'
      OR r.owner_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    );
$$;
