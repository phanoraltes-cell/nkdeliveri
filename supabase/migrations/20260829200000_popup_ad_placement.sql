-- PROMPT MODIFIKASYON (10 TACH) — Tach 5: nouvo tip anons "popup" (modal,
-- focus-trap, limit frekans, jamè pandan checkout).
--
-- ENVANTÈ: `sponsored_placements` deja gen tout enfrastrikti (tit,
-- deskripsyon, medya, dat, RPC CRUD, `get_active_placements_secure`) pou
-- 4 plasman ki egziste deja (home_banner/search_results/restaurant_page/
-- dashboard) — yon `placement` se yon senp valè `text` ak yon CHECK
-- constraint, pa yon done separe. "Popup" se yon SENKYÈM VALÈ `placement`,
-- pa yon nouvo tab/RPC — menm mekanis, menm fòm admin (dashboard.admin.ads.
-- tsx deja gen tout chan yo).
--
-- Focus-trap, ESC pou fèmen, ak wòl ARIA "dialog" se travay FRONTEND
-- (Radix Dialog, deja itilize nan sit la — src/components/ui/dialog.tsx —
-- bay sa a gratis, pa gen anyen SQL pou fè pou sa). Limit frekans lan
-- (yon fwa pou 24 èdtan pou menm anons/menm navigatè) ak "jamè pandan
-- checkout" se lojik CLIENT (localStorage + chemen URL aktyèl la), tou de
-- deside pou pi devan nan frontend.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Elaji CHECK constraint `placement` la pou aksepte 'popup'. Non
--    constraint la se non default Postgres bay yon CHECK kolòn san non
--    eksplisit (`<tab>_<kolòn>_check`) — deterministik, pa yon supozisyon
--    (wè 20260722220000_sponsored_placements.sql:16, kote li te deklare
--    san `CONSTRAINT nom` eksplisit).
ALTER TABLE public.sponsored_placements
  DROP CONSTRAINT IF EXISTS sponsored_placements_placement_check;
ALTER TABLE public.sponsored_placements
  ADD CONSTRAINT sponsored_placements_placement_check
  CHECK (placement IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard', 'popup'));

-- ---------------------------------------------------------------------------
-- 2) create_sponsored_placement_secure — CREATE OR REPLACE sèlman (menm
--    siyati 20-paramèt apre Tach 4, 20260829180000), sèl chanjman: lis
--    `_placement` valid la aksepte 'popup' kounye a.
--    update_sponsored_placement_secure PA bezwen touche — li pa gen
--    okenn paramèt `_placement` ditou (fòm admin lan dezaktive `<select>`
--    plasman an apre kreyasyon, wè disabled={!!placement}).
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
  _is_active boolean DEFAULT true,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
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
  IF _placement NOT IN ('home_banner', 'search_results', 'restaurant_page', 'dashboard', 'popup') THEN
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
    description, is_active, media_width, media_height
  ) VALUES (
    _placement, _restaurant_id, btrim(_title), v_media_url, _link_url, _starts_at, _ends_at, _sort_order, v_user,
    _media_type, v_media_url, _media_path, _thumbnail_url, _media_items, _alt_text, _link_target, _cta_label,
    btrim(_description), _is_active, _media_width, _media_height
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'sponsored_placement.created',
    jsonb_build_object('id', v_row.id, 'placement', v_row.placement));

  RETURN v_row;
END;
$$;
-- No REVOKE/GRANT here — menm siyati, grants inchanje.

-- ---------------------------------------------------------------------------
-- 3) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829200000', 'popup_ad_placement')
ON CONFLICT (version) DO NOTHING;

COMMIT;
