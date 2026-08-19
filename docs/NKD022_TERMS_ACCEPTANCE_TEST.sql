-- NKD-022 combined migration + test — WRITTEN, per Règ A1 run this yourself
-- in the SQL Editor (or explicitly authorize it) — never CLI. BEGIN...
-- ROLLBACK — nothing here survives, including the migration itself. This
-- is a rehearsal to see the test_results table before deciding to apply
-- for real. Format per Règ A10: results in a temp table + SELECT before
-- ROLLBACK, not RAISE NOTICE (invisible in SQL Editor).

BEGIN;

-- =====================  MIGRATION (rehearsal)  =====================
-- Verbatim copy of 20260818140000_nkd022_terms_acceptance.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_type text := COALESCE(NEW.raw_user_meta_data->>'account_type', 'customer');
  v_first_name text := NEW.raw_user_meta_data->>'first_name';
  v_last_name text := NEW.raw_user_meta_data->>'last_name';
  v_phone text := NEW.raw_user_meta_data->>'phone';
  v_address text := NEW.raw_user_meta_data->>'address';
  v_terms_version text := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
  v_slug text;
  v_hours jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO public.profiles (
    id, first_name, last_name, avatar_url, phone, address, terms_accepted_at, terms_version
  )
  VALUES (
    NEW.id, v_first_name, v_last_name,
    NEW.raw_user_meta_data->>'avatar_url', v_phone, v_address,
    CASE WHEN v_terms_version IS NOT NULL THEN now() ELSE NULL END,
    v_terms_version
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

    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'new_customer_signup',
      'admin',
      'Nouvo kliyan enskri',
      trim(both ' ' from COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, '')) || ' fèk kreye yon kont kliyan.',
      jsonb_build_object('customer_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_terms_secure(_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ou dwe konekte.';
  END IF;
  IF _version IS NULL OR btrim(_version) = '' THEN
    RAISE EXCEPTION 'Vèsyon dokiman an obligatwa.';
  END IF;

  UPDATE public.profiles
  SET terms_accepted_at = now(), terms_version = _version
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pwofil pa jwenn pou itilizatè sa a.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_terms_secure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_terms_secure(text) TO authenticated;

-- =====================  TEST (Règ A10 format)  =====================

CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_no_terms uuid := gen_random_uuid();   -- signup with NO terms_version in metadata
  v_with_terms uuid := gen_random_uuid(); -- signup WITH terms_version in metadata
  v_owner uuid := gen_random_uuid();      -- restaurant signup, to confirm the fix isn't customer-only
  v_row record;
  v_caught boolean;
BEGIN
  -- T1/T7 setup: two customer signups (one without, one with terms_version),
  -- one restaurant signup (with terms_version) — all via a real INSERT INTO
  -- auth.users, which fires the real AFTER INSERT trigger (handle_new_user),
  -- same technique already used and confirmed safe by NKD-011's own test.
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_no_terms, 'nkd022-noterms@example.com', 'x', now(), '{}',
      '{"account_type":"customer","first_name":"San","last_name":"Kondisyon"}'),
    (v_with_terms, 'nkd022-withterms@example.com', 'x', now(), '{}',
      '{"account_type":"customer","first_name":"Ak","last_name":"Kondisyon","terms_version":"1.0"}'),
    (v_owner, 'nkd022-owner@example.com', 'x', now(), '{}',
      '{"account_type":"restaurant","restaurant_name":"NKD022 Test Resto","terms_version":"1.0"}');

  -- T0 — schema present.
  INSERT INTO test_results
  SELECT 'T0',
    CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
    'kolòn jwenn: ' || string_agg(column_name, ', ')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name IN ('terms_accepted_at', 'terms_version');

  -- T1 — signup with NO terms_version metadata leaves both columns NULL
  -- (must-accept path preserved; no acceptance ever fabricated).
  SELECT terms_accepted_at, terms_version INTO v_row FROM public.profiles WHERE id = v_no_terms;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN v_row.terms_accepted_at IS NULL AND v_row.terms_version IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'accepted_at=' || COALESCE(v_row.terms_accepted_at::text, 'NULL') || ' version=' || COALESCE(v_row.terms_version, 'NULL'));

  -- T2 — signup WITH terms_version='1.0' stamps both columns at signup time.
  SELECT terms_accepted_at, terms_version INTO v_row FROM public.profiles WHERE id = v_with_terms;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN v_row.terms_accepted_at IS NOT NULL AND v_row.terms_version = '1.0' THEN 'PASS' ELSE 'FAIL' END,
    'accepted_at=' || COALESCE(v_row.terms_accepted_at::text, 'NULL') || ' version=' || COALESCE(v_row.terms_version, 'NULL'));

  -- T7 — same stamping applies to the restaurant branch too (the INSERT
  -- with terms columns runs before the account_type IF/ELSIF, so this
  -- confirms the fix isn't accidentally customer-only).
  SELECT terms_accepted_at, terms_version INTO v_row FROM public.profiles WHERE id = v_owner;
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN v_row.terms_accepted_at IS NOT NULL AND v_row.terms_version = '1.0' THEN 'PASS' ELSE 'FAIL' END,
    'accepted_at=' || COALESCE(v_row.terms_accepted_at::text, 'NULL') || ' version=' || COALESCE(v_row.terms_version, 'NULL'));

  -- T3 — accept_terms_secure() with no session rejected.
  v_caught := false;
  BEGIN
    PERFORM public.accept_terms_secure('1.0');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  INSERT INTO test_results VALUES ('T3', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'san sesyon, rejte tan pou tan: ' || v_caught::text);

  -- T4 — accept_terms_secure('1.0') as v_no_terms (the account that had
  -- neither column set) succeeds and stamps its own row.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_terms, 'role', 'authenticated')::text, true);
  PERFORM public.accept_terms_secure('1.0');
  RESET ROLE;
  SELECT terms_accepted_at, terms_version INTO v_row FROM public.profiles WHERE id = v_no_terms;
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN v_row.terms_accepted_at IS NOT NULL AND v_row.terms_version = '1.0' THEN 'PASS' ELSE 'FAIL' END,
    'accepted_at=' || COALESCE(v_row.terms_accepted_at::text, 'NULL') || ' version=' || COALESCE(v_row.terms_version, 'NULL'));

  -- T5 — accept_terms_secure(NULL) / empty string rejected, even with a
  -- valid session.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_terms, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.accept_terms_secure(NULL);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T5', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'vèsyon NULL rejte: ' || v_caught::text);

  -- T6 — accept_terms_secure() as v_no_terms (T4, just accepted) never
  -- touched v_with_terms's row (scoping is auth.uid()-only, not a target
  -- user_id parameter — no cross-account write surface at all).
  SELECT terms_accepted_at, terms_version INTO v_row FROM public.profiles WHERE id = v_with_terms;
  INSERT INTO test_results VALUES ('T6',
    CASE WHEN v_row.terms_accepted_at IS NOT NULL AND v_row.terms_version = '1.0' THEN 'PASS' ELSE 'FAIL' END,
    'lòt itilizatè pa afekte: accepted_at=' || COALESCE(v_row.terms_accepted_at::text, 'NULL'));
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
