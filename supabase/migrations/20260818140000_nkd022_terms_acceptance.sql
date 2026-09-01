-- NKD-022 — CGU/Politik Konfidansyalite: track acceptance instead of just
-- gating submit client-side. Règ A4 leve pou tout seri NKD-022 (odit Faz
-- 3-11 fèmen — docs/archive/misc/PROTOKOL_FAZ3_A_FAZ11.md). A5 pa aplike: pa gen okenn
-- chanjman sou logic peman/estati kòmand isit la.
--
-- Before this: every registration form (customer-form.tsx, driver-form.tsx,
-- restaurant-form.tsx) already required an unchecked-by-default "terms"
-- checkbox client-side (`if (!f.terms) return toast.error(...)`), but that
-- checkbox's value was never sent anywhere — baseSignUp()'s metadata payload
-- dropped it entirely, and the checkbox's own link text wasn't even a real
-- <a href>. Confirmed by reading all 3 forms verbatim (NKD-022 Etap 1): if a
-- dispute ever arose, there was nothing to show a customer had agreed to
-- anything. This migration adds the two columns that make an acceptance a
-- provable fact — which document version, when — plus the RPC that records
-- it for an already-existing session.
--
-- Owner-confirmed decisions (KANPE EPI MANDE round):
--   1. Storage: two columns on public.profiles (terms_accepted_at,
--      terms_version), not a dedicated history table. Matches this
--      project's low-volume precedent (2 test customers today) and the
--      "simplest structure that still answers 'which version, when'"
--      standard already used for e.g. NKD-011's idempotency_key.
--   2. Retention: NKD-021 confirmed no retention policy exists anywhere in
--      this project yet — the Privacy Policy (Etap 2) documents that
--      honestly ("pou tout tan pou kounye a") rather than promising a
--      schedule this migration doesn't implement. No retention logic
--      belongs in this file.
--   3. Existing accounts: NOT backfilled/grandfathered. terms_accepted_at
--      stays NULL for every account that existed before this migration —
--      they see the same mandatory acceptance gate a new signup would, on
--      their next authenticated page load (src/components/terms-acceptance-
--      gate.tsx, wired into _authenticated/route.tsx). With 2 real
--      customers today this costs nothing and avoids ever claiming an
--      acceptance that was never actually given.
--
-- New signups are stamped directly inside handle_new_user() (§2 below) from
-- signup metadata, not by calling accept_terms_secure() after the fact —
-- signUp() can return with no session at all when email confirmation is
-- required (register-shared.logic.ts:28-31's own comment), so there may be
-- no authenticated caller to run an RPC as. The registration forms now send
-- `terms_version` in that same metadata payload precisely so this trigger
-- can stamp acceptance atomically with account creation, using the same
-- INSERT that already runs.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.accept_terms_secure(text);
--   -- Re-apply the immediately-prior CREATE OR REPLACE of handle_new_user()
--   -- verbatim (20260812100000_komand_admin_module.sql:94-198).
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_at;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_version;
--
-- Wrapped in BEGIN...COMMIT (A11/NKD-011 lesson): the DROP FUNCTION +
-- CREATE FUNCTION pair on handle_new_user() below must never leave a real
-- window where the AFTER INSERT ON auth.users trigger's target function
-- doesn't exist — a signup landing in that gap would hard-fail instead of
-- creating an account. Every statement here is ordinary transactional DDL.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema. Both nullable: NULL is the correct, meaningful "never accepted"
--    state (existing accounts today, and any future signup path that
--    somehow bypasses every form's required checkbox) — never defaulted to
--    now()/a version string, which would fabricate consent.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'NKD-022: when this account last accepted the Kondisyon Itilizasyon / Politik Konfidansyalite. NULL = never accepted — terms-acceptance-gate.tsx blocks the dashboard until this is set.';
COMMENT ON COLUMN public.profiles.terms_version IS
  'NKD-022: which document version (src/lib/legal.ts CURRENT_TERMS_VERSION) was accepted at terms_accepted_at.';

-- ---------------------------------------------------------------------------
-- 2) handle_new_user() — stamp acceptance at signup time when the client
--    sent terms_version (every registration form does, since the checkbox
--    is already required to submit — customer-form.tsx/driver-form.tsx/
--    restaurant-form.tsx). Full body reproduced (CREATE OR REPLACE requires
--    the complete function), diffed against the live
--    20260812100000_komand_admin_module.sql:94-198 version — unchanged
--    except v_terms_version and the two new columns in the profiles INSERT.
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

-- ---------------------------------------------------------------------------
-- 3) accept_terms_secure — records acceptance for an ALREADY-authenticated
--    session (the existing-account re-acceptance gate; new signups are
--    stamped directly by §2 above, since they may have no session yet).
--    SECURITY DEFINER strictly scoped to auth.uid()'s own row — no target
--    user id parameter, so there is no privilege-escalation surface (no
--    caller can ever stamp acceptance for anyone but themselves).
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

-- ---------------------------------------------------------------------------
-- 4) Règ A11 (docs/archive/misc/PROTOKOL_FAZ3_A_FAZ11.md) — this migration is applied
--    manually (SQL Editor, not `supabase db push`), so the schema_migrations
--    bookkeeping INSERT must be the LAST statement of this same script/
--    transaction, before COMMIT — never a separate later step.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260818140000', 'nkd022_terms_acceptance')
ON CONFLICT (version) DO NOTHING;

COMMIT;
