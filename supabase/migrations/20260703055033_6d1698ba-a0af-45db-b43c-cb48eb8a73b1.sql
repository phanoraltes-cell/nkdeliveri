
-- 1. Enum for driver/restaurant status already exists (restaurant_status). Add driver_status.
DO $$ BEGIN
  CREATE TYPE public.driver_status AS ENUM ('pending','approved','suspended','rejected','offline','online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Drivers table
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  phone text,
  address text,
  vehicle_type text,
  license_plate text,
  id_doc_url text,
  license_doc_url text,
  vehicle_photo_url text,
  status public.driver_status NOT NULL DEFAULT 'pending',
  current_lat numeric,
  current_lng numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers_self_select" ON public.drivers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "drivers_self_update" ON public.drivers FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "drivers_admin_all" ON public.drivers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER drivers_updated_at BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Restaurant employees
CREATE TABLE IF NOT EXISTS public.restaurant_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_employees TO authenticated;
GRANT ALL ON public.restaurant_employees TO service_role;
ALTER TABLE public.restaurant_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_owner_manage" ON public.restaurant_employees FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "emp_self_read" ON public.restaurant_employees FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 4. Update profiles to accept phone at signup (column exists). Nothing to add.

-- 5. New signup handler that reads account_type + creates related rows
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
  -- Profile always
  INSERT INTO public.profiles (id, first_name, last_name, avatar_url, phone, address)
  VALUES (
    NEW.id,
    v_first_name,
    v_last_name,
    NEW.raw_user_meta_data->>'avatar_url',
    v_phone,
    v_address
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

  -- Auto-grant admin to allowlisted email (only when verified)
  IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'phanoraltes@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Also grant admin on email confirmation for the allowlist
CREATE OR REPLACE FUNCTION public.grant_admin_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'phanoraltes@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_grant_admin
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.grant_admin_on_confirm();

-- 7. Helper view/function to get primary role (highest priority)
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role::text
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'restaurant_owner' THEN 3
    WHEN 'restaurant_staff' THEN 4
    WHEN 'driver' THEN 5
    WHEN 'customer' THEN 6
    ELSE 7 END
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_primary_role(uuid) TO authenticated, anon;
