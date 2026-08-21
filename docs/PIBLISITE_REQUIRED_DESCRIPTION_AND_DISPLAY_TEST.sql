-- Piblisite refonte — tès pou 20260820100000_piblisite_required_description_and_display.sql.
-- REHEARSE-STYLE (BEGIN...ROLLBACK) — migrasyon an poko aplike an
-- pwodiksyon. Fichye sa a kole kò migrasyon an DIREK DEDAN menm
-- transaksyon tès la (menm apwòch ak tout tès "rehearse" anvan nan pwojè
-- sa a), teste li, epi ROLLBACK — anyen pa rete si l echwe, e anyen pa
-- rete menm si tout tès yo PASS (se objektif ROLLBACK la). Aplikasyon
-- reyèl la se yon etap SEPARE apre konfimasyon eksplisit.
--
-- Règ A10: rezilta ekri nan yon tab tanporè + SELECT anvan ROLLBACK.

BEGIN;

-- ===========================================================================
-- Kò migrasyon an (kole verbatim soti nan
-- 20260820100000_piblisite_required_description_and_display.sql, san
-- pwòp BEGIN/COMMIT/schema_migrations li — sa yo se pou aplikasyon reyèl
-- la sèlman, pa yon rehearsal ki ap ROLLBACK).
CREATE OR REPLACE FUNCTION public.create_sponsored_placement_secure(
  _placement text,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _restaurant_id uuid DEFAULT NULL,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _placement NOT IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard') THEN
    RAISE EXCEPTION 'Anplasman envalid';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  INSERT INTO public.sponsored_placements (
    placement, restaurant_id, title, image_url, link_url, starts_at, ends_at, sort_order, created_by,
    media_type, media_url, media_path, thumbnail_url, media_items, alt_text, link_target, cta_label,
    description, is_active
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_sponsored_placement_secure(
  _id uuid,
  _title text,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _is_active boolean,
  _image_url text DEFAULT NULL,
  _link_url text DEFAULT NULL,
  _sort_order int DEFAULT 0,
  _media_type text DEFAULT 'image',
  _media_url text DEFAULT NULL,
  _media_path text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _media_items jsonb DEFAULT '[]'::jsonb,
  _alt_text text DEFAULT NULL,
  _link_target text DEFAULT 'new_tab',
  _cta_label text DEFAULT NULL,
  _description text DEFAULT NULL
)
RETURNS public.sponsored_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.sponsored_placements;
  v_media_url text := COALESCE(_media_url, _image_url);
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon tit';
  END IF;
  IF _description IS NULL OR length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Tanpri antre yon deskripsyon';
  END IF;
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Dat fen dwe apre dat kòmansman';
  END IF;
  IF _media_type NOT IN ('image', 'video', 'carousel', 'none') THEN
    RAISE EXCEPTION 'Tip medya envalid';
  END IF;
  IF _link_target NOT IN ('same_tab', 'new_tab', 'in_app') THEN
    RAISE EXCEPTION 'Sib lyen envalid';
  END IF;

  UPDATE public.sponsored_placements SET
    title = btrim(_title), image_url = v_media_url, link_url = _link_url,
    starts_at = _starts_at, ends_at = _ends_at, is_active = _is_active, sort_order = _sort_order,
    media_type = _media_type, media_url = v_media_url, media_path = _media_path,
    thumbnail_url = _thumbnail_url, media_items = _media_items, alt_text = _alt_text,
    link_target = _link_target, cta_label = _cta_label, description = btrim(_description)
  WHERE id = _id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placement not found';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sponsored_placement_secure(text, text, timestamptz, timestamptz, uuid, text, text, int, text, text, text, text, jsonb, text, text, text, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_sponsored_placement_secure(uuid, text, timestamptz, timestamptz, boolean, text, text, int, text, text, text, text, jsonb, text, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_active_placements_secure(text, int);
CREATE FUNCTION public.get_active_placements_secure(_placement text, _limit int DEFAULT 5)
RETURNS TABLE (
  id uuid, placement text, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  restaurant_cover_url text, restaurant_cuisine text, restaurant_rating numeric,
  restaurant_avg_prep_time int, restaurant_delivery_fee numeric, restaurant_address text,
  title text, image_url text, link_url text, sort_order int,
  media_type text, media_url text, thumbnail_url text, media_items jsonb, alt_text text,
  link_target text, cta_label text, description text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.id, sp.placement, sp.restaurant_id, r.name, r.slug, r.cover_url, r.cuisine,
    r.rating, r.avg_prep_time, r.delivery_fee, r.address,
    sp.title, sp.image_url, sp.link_url, sp.sort_order,
    sp.media_type, sp.media_url, sp.thumbnail_url, sp.media_items, sp.alt_text,
    sp.link_target, sp.cta_label, sp.description
  FROM public.sponsored_placements sp
  LEFT JOIN public.restaurants r ON r.id = sp.restaurant_id
  WHERE sp.placement = _placement
    AND sp.is_active AND now() >= sp.starts_at AND now() <= sp.ends_at
    AND (sp.restaurant_id IS NULL OR r.status = 'approved')
  ORDER BY sp.sort_order ASC, sp.created_at DESC
  LIMIT _limit;
$$;
REVOKE ALL ON FUNCTION public.get_active_placements_secure(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_placements_secure(text, int) TO anon, authenticated;

-- ===========================================================================
-- Tès yo.
CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_placement uuid;
  v_row record;
  v_caught boolean;
  v_errmsg text;
  v_count int;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'piblisite-desc-admin@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'piblisite-desc-customer@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'piblisite-desc-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'piblisite-desc-test-resto', 'Piblisite Desc Test Resto', 'approved', 0);

  -- T1 — admin create WITHOUT description -> rejected. The frontend never
  -- shows this message (client-side check blocks submission first), but
  -- the RPC must enforce it independently regardless — same
  -- defense-in-depth as every other _secure RPC in this project.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_sponsored_placement_secure('home_banner', 'Tit san deskripsyon',
      now(), now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN v_caught AND v_errmsg = 'Tanpri antre yon deskripsyon' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T2 — admin create WITH description -> succeeds, description saved
  -- (btrim applied, matching _title's own convention).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_placement := (public.create_sponsored_placement_secure(
    _placement := 'home_banner', _title := 'Anons tès deskripsyon',
    _starts_at := now(), _ends_at := now() + interval '7 days',
    _description := '  Yon deskripsyon tès  ',
    _media_type := 'image', _media_url := 'https://cdn.example.com/ads-media/desc-test/1.webp',
    _alt_text := 'Tès'
  )).id;
  RESET ROLE;
  SELECT description INTO v_row FROM public.sponsored_placements WHERE id = v_placement;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN v_row.description = 'Yon deskripsyon tès' THEN 'PASS' ELSE 'FAIL' END,
    'description=' || COALESCE(v_row.description, 'NULL'));

  -- T3 — admin update WITHOUT description -> rejected. This is the
  -- consequence that matters most: an ad created before this migration has
  -- description = NULL today, so its very NEXT edit must be blocked until
  -- one is provided — confirms that's really enforced, not just on create.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.update_sponsored_placement_secure(
      _id := v_placement, _title := 'Anons tès (modifye)',
      _starts_at := now(), _ends_at := now() + interval '10 days', _is_active := true
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN v_caught AND v_errmsg = 'Tanpri antre yon deskripsyon' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T4 — admin update WITH description -> succeeds, updated.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.update_sponsored_placement_secure(
    _id := v_placement, _title := 'Anons tès (modifye)',
    _starts_at := now(), _ends_at := now() + interval '10 days', _is_active := true,
    _description := 'Nouvo deskripsyon apre modifikasyon'
  );
  RESET ROLE;
  SELECT description INTO v_row FROM public.sponsored_placements WHERE id = v_placement;
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN v_row.description = 'Nouvo deskripsyon apre modifikasyon' THEN 'PASS' ELSE 'FAIL' END,
    'description=' || COALESCE(v_row.description, 'NULL'));

  -- T5 — non-admin still rejected with 'Forbidden' BEFORE the description
  -- check even runs (role-check ordering unchanged by this migration).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_sponsored_placement_secure('home_banner', 'X', now(), now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T5', CASE WHEN v_caught AND v_errmsg = 'Forbidden' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T6 — get_active_placements_secure now returns the media/description
  -- columns for an active placement (this is the RPC every public-facing
  -- renderer actually calls — without this, Étape 2/3/4's media never
  -- reaches the site regardless of what's saved in the admin dashboard).
  SET ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT media_type, media_url, alt_text, description INTO v_row
    FROM public.get_active_placements_secure('home_banner', 50)
    WHERE id = v_placement;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T6',
    CASE WHEN v_row.media_type = 'image'
           AND v_row.media_url = 'https://cdn.example.com/ads-media/desc-test/1.webp'
           AND v_row.alt_text = 'Tès'
           AND v_row.description = 'Nouvo deskripsyon apre modifikasyon'
         THEN 'PASS' ELSE 'FAIL' END,
    'media_url=' || COALESCE(v_row.media_url, 'NULL') || ' description=' || COALESCE(v_row.description, 'NULL'));

  -- T7 — get_active_placements_secure regression check: WHERE clause
  -- (is_active / date range) still filters correctly — deactivate the test
  -- row and confirm it disappears from the results.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.update_sponsored_placement_secure(
    _id := v_placement, _title := 'Anons tès (modifye)',
    _starts_at := now(), _ends_at := now() + interval '10 days', _is_active := false,
    _description := 'Nouvo deskripsyon apre modifikasyon'
  );
  RESET ROLE;
  SET ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT count(*) INTO v_count FROM public.get_active_placements_secure('home_banner', 50) WHERE id = v_placement;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T7', CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    'anons dezaktive toujou egzante: ' || (v_count = 0)::text);
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
