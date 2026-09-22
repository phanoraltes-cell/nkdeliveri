-- ===========================================================================
-- ROLLBACK — 20260910000000_cuisines_normalization.sql
-- ===========================================================================
-- Fichye sa a se PA yon migrasyon. Li pa nan dosye migrations/ prensipal la
-- eksprè: li pa dwe kouri otomatikman, JAMÈ. Se yon zouti pou yon sèl ka —
-- si yon bagay mal pase apre migrasyon an epi ou vle retounen an aryè.
--
-- ---------------------------------------------------------------------------
-- POUKISA LI SAN DANJE
--
-- Migrasyon an pa t efase ni chanje `restaurants.cuisine`. Tout done
-- orijinal yo toujou la, entak. Donk defèt estrikti nouvo a pa fè pèdi
-- okenn enfòmasyon ki te egziste anvan.
--
-- SA W AP PÈDI: chwa kuizin yo restoratè yo fè APRE migrasyon an nan nouvo
-- fòm nan (kontni `restaurant_cuisines`). Si sa gen valè, kopye l anvan —
-- gade §0.
--
-- ---------------------------------------------------------------------------
-- LÒD LA KONTE: `restaurant_cuisines` anvan `cuisines` (kle etranje), epi
-- fonksyon an an dènye (backfill la sèvi ak li).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) OPSYONÈL, MEN REKÒMANDE — kopye chwa yo anvan ou efase.
--
-- Retire kòmantè a sou blòk sa a si w vle kenbe yon tras. Tab la ap rete
-- nan baz la apre rollback la; efase l alamen lè ou fin sèten.
--
-- CREATE TABLE IF NOT EXISTS public._backup_restaurant_cuisines_20260910 AS
-- SELECT rc.restaurant_id, r.slug AS restaurant_slug, c.slug AS cuisine_slug,
--        rc.is_primary, rc.created_at
-- FROM public.restaurant_cuisines rc
-- JOIN public.restaurants r ON r.id = rc.restaurant_id
-- JOIN public.cuisines c ON c.id = rc.cuisine_id;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Politik yo. `DROP TABLE` ta pote yo ale kanmenm; nou nonmen yo
--    eksplisitman pou fichye a li tankou yon envantè konplè de sa
--    migrasyon an te kreye.
DROP POLICY IF EXISTS "restaurant_cuisines owner delete" ON public.restaurant_cuisines;
DROP POLICY IF EXISTS "restaurant_cuisines owner update" ON public.restaurant_cuisines;
DROP POLICY IF EXISTS "restaurant_cuisines owner insert" ON public.restaurant_cuisines;
DROP POLICY IF EXISTS "restaurant_cuisines public read" ON public.restaurant_cuisines;

DROP POLICY IF EXISTS "cuisines admin update" ON public.cuisines;
DROP POLICY IF EXISTS "cuisines admin insert" ON public.cuisines;
DROP POLICY IF EXISTS "cuisines public read" ON public.cuisines;

-- ---------------------------------------------------------------------------
-- 2) Tab yo — lyen an anvan referans lan.
DROP TABLE IF EXISTS public.restaurant_cuisines;
DROP TABLE IF EXISTS public.cuisines;

-- ---------------------------------------------------------------------------
-- 3) Fonksyon nòmalizasyon an.
DROP FUNCTION IF EXISTS public.normalize_cuisine_text(text);

-- ---------------------------------------------------------------------------
-- 4) `unaccent` RETE ENSTALE, eksprè.
--
-- Yon ekstansyon se yon resous pataje. Yon lòt migrasyon oswa yon lòt
-- fonksyon ta ka deja depann de li san fichye sa a konnen. Yon
-- `DROP EXTENSION` isit la ta ka kase yon bagay ki pa gen anyen pou wè ak
-- kuizin. Yon ekstansyon ki rete enstale pa fè okenn mal.

COMMIT;

-- ===========================================================================
-- APRE ROLLBACK LA — verifye kolòn orijinal la toujou entak:
--
--   SELECT count(*) FILTER (WHERE cuisine IS NOT NULL) AS valè_ki_rete,
--          count(*) AS total
--   FROM public.restaurants;
--
-- Si `valè_ki_rete` pa chanje, pa gen anyen ki pèdi.
-- ===========================================================================
