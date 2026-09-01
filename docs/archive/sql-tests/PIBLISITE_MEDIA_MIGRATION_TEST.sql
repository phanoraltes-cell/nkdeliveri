-- Piblisite refonte — POST-APPLICATION verification test.
--
-- 20260819130000_sponsored_placements_media.sql was already applied to
-- production directly (confirmed: "Success. No rows returned") before this
-- file was run — the original version of this file assumed the opposite
-- order (rehearse first, apply after) and tried to re-create objects that
-- already exist, hence the 42P07 error. This version does NOT replay the
-- migration at all — it only exercises the schema/RPCs that are already
-- live, using fresh fake data wrapped in BEGIN...ROLLBACK so none of the
-- test rows persist. Règ A10 format: results in a temp table + SELECT
-- before ROLLBACK.

BEGIN;

CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_placement uuid;
  v_row record;
  v_caught boolean;
  v_errmsg text;
  v_count int;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'piblisite-admin@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'piblisite-customer@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'piblisite-owner@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'piblisite-test-resto-2', 'Piblisite Test Resto 2', 'approved', 0);

  -- T0 — schema present (confirms the already-applied migration's shape,
  -- doesn't assume it).
  INSERT INTO test_results
  SELECT 'T0',
    CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END,
    'kolòn jwenn: ' || string_agg(column_name, ', ')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sponsored_placements'
    AND column_name IN ('media_type', 'media_url', 'media_path', 'thumbnail_url', 'media_items',
                         'alt_text', 'link_target', 'cta_label', 'description', 'impressions', 'clicks');

  -- T1 — backfill behavior, re-verified directly: insert a fresh "legacy"
  -- row (image_url only, no media_url) the same way an old row would have
  -- looked BEFORE the migration ran, then run the exact same backfill
  -- UPDATE the migration used, scoped to only this one row so it can't
  -- touch any real production row.
  INSERT INTO public.sponsored_placements (id, placement, title, image_url, starts_at, ends_at, created_by)
  VALUES (v_legacy, 'home_banner', 'Ansyen anons (legacy, tès)',
          'https://example.com/legacy-banner.jpg', now() - interval '1 day', now() + interval '30 days', v_admin);
  UPDATE public.sponsored_placements
  SET media_url = image_url, media_type = 'image'
  WHERE id = v_legacy AND image_url IS NOT NULL AND btrim(image_url) <> '' AND media_url IS NULL;
  SELECT media_url, media_type INTO v_row FROM public.sponsored_placements WHERE id = v_legacy;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN v_row.media_url = 'https://example.com/legacy-banner.jpg' AND v_row.media_type = 'image'
         THEN 'PASS' ELSE 'FAIL' END,
    'media_url=' || COALESCE(v_row.media_url, 'NULL') || ' media_type=' || COALESCE(v_row.media_type, 'NULL'));

  -- T2 — non-admin rejected.
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
  INSERT INTO test_results VALUES ('T2', CASE WHEN v_caught AND v_errmsg = 'Forbidden' THEN 'PASS' ELSE 'FAIL' END,
    'non-admin rejte: ' || v_caught::text);

  -- T3 — admin create with full media fields -> media_url/image_url both
  -- populated (backward compat), all new fields saved correctly.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_placement := (public.create_sponsored_placement_secure(
    _placement := 'home_banner', _title := 'Nouvo anons videyo',
    _starts_at := now(), _ends_at := now() + interval '7 days',
    _media_type := 'video', _media_url := 'https://cdn.example.com/ads-media/x/1.mp4',
    _media_path := 'x/1.mp4', _thumbnail_url := 'https://cdn.example.com/ads-media/x/1-poster.jpg',
    _alt_text := 'Livrè k ap kouri', _link_target := 'in_app', _cta_label := 'Kòmande kounye a',
    _description := 'Pwomosyon espesyal'
  )).id;
  RESET ROLE;
  SELECT media_type, media_url, image_url, media_path, thumbnail_url, alt_text, link_target, cta_label, description
  INTO v_row FROM public.sponsored_placements WHERE id = v_placement;
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN v_row.media_type = 'video' AND v_row.media_url = v_row.image_url
           AND v_row.media_path = 'x/1.mp4' AND v_row.cta_label = 'Kòmande kounye a'
           AND v_row.link_target = 'in_app'
         THEN 'PASS' ELSE 'FAIL' END,
    'media_type=' || v_row.media_type || ' image_url=synced:' || (v_row.media_url = v_row.image_url)::text);

  -- T4 — update keeps image_url/media_url in sync too.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.update_sponsored_placement_secure(
    _id := v_placement, _title := 'Nouvo anons videyo (modifye)',
    _starts_at := now(), _ends_at := now() + interval '10 days', _is_active := true,
    _media_type := 'image', _media_url := 'https://cdn.example.com/ads-media/x/2.webp'
  );
  RESET ROLE;
  SELECT media_url, image_url, media_type INTO v_row FROM public.sponsored_placements WHERE id = v_placement;
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN v_row.media_url = v_row.image_url AND v_row.media_type = 'image' THEN 'PASS' ELSE 'FAIL' END,
    'apre update: media_url=' || v_row.media_url);

  -- T5 — invalid media_type rejected.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_sponsored_placement_secure('home_banner', 'X', now(), now() + interval '1 day',
      _media_type := 'gif_pa_valid');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T5', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END, 'media_type envalid rejte');

  -- T6 — invalid link_target rejected.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_sponsored_placement_secure('home_banner', 'X', now(), now() + interval '1 day',
      _link_target := 'nouvo_fenet_pa_valid');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T6', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END, 'link_target envalid rejte');

  -- T7 — anon can log an impression; counter + event row both land.
  SET ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM public.log_ad_event_secure(v_placement, 'impression', 'sess-123', 'web');
  RESET ROLE;
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN (SELECT impressions FROM public.sponsored_placements WHERE id = v_placement) = 1
           AND EXISTS (SELECT 1 FROM public.sponsored_placement_events WHERE placement_id = v_placement AND event_type = 'impression')
         THEN 'PASS' ELSE 'FAIL' END,
    'impressions=' || (SELECT impressions FROM public.sponsored_placements WHERE id = v_placement)::text);

  -- T8 — authenticated click captures user_id, bumps clicks.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  PERFORM public.log_ad_event_secure(v_placement, 'click', 'sess-123', 'web');
  RESET ROLE;
  SELECT user_id INTO v_row FROM public.sponsored_placement_events
    WHERE placement_id = v_placement AND event_type = 'click' LIMIT 1;
  INSERT INTO test_results VALUES ('T8',
    CASE WHEN (SELECT clicks FROM public.sponsored_placements WHERE id = v_placement) = 1
           AND v_row.user_id = v_customer
         THEN 'PASS' ELSE 'FAIL' END,
    'clicks=1 e user_id kapte: ' || (v_row.user_id = v_customer)::text);

  -- T9 — non-admin cannot read sponsored_placement_events (RLS). Scoped to
  -- this test's own placement_id so a non-empty production table doesn't
  -- produce a false PASS via unrelated rows this role also can't see.
  -- RESET ROLE happens BEFORE the INSERT into test_results below — the
  -- temp table was created by the session's real role and "authenticated"
  -- has no privileges on it (this ordering bug is exactly what produced
  -- the 42501 permission-denied error on the previous run).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.sponsored_placement_events WHERE placement_id = v_placement;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9', CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    'non-admin wè ' || v_count::text || ' ranje pou plasman tès la (dwe 0)');

  -- T10 — admin CAN read sponsored_placement_events.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.sponsored_placement_events WHERE placement_id = v_placement;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T10', CASE WHEN v_count = 2 THEN 'PASS' ELSE 'FAIL' END,
    'admin wè ' || v_count::text || ' ranje (dwe 2: impression+click)');

  -- T11 — non-admin cannot insert into ads-media (storage RLS).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('ads-media', 'test-non-admin.jpg', v_customer);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T11', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'non-admin pa ka telechaje nan ads-media: ' || v_caught::text);

  -- T12 — admin CAN insert into ads-media.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('ads-media', 'test-admin.jpg', v_admin);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T12', CASE WHEN NOT v_caught THEN 'PASS' ELSE 'FAIL' END,
    'admin ka telechaje nan ads-media: ' || (NOT v_caught)::text);
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
