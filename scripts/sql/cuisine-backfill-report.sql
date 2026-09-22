-- ===========================================================================
-- RAPÒ BACKFILL KUIZIN — LI SÈLMAN, li pa chanje anyen
-- ===========================================================================
-- Kouri sa a nan SQL Editor Supabase APRE migrasyon
-- 20260910000000_cuisines_normalization.sql, AVAN nenpòt kòd aplikasyon
-- deplwaye.
--
-- Rezilta ki atann sou done aktyèl yo (2 restoran):
--   'kreyol'          -> kreyol   (1 restoran)
--   'Manje kreyol '   -> kreyol   (1 restoran)
--   ZEWO ranje nan seksyon B (valè ki pa mape)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A) CHAK VALÈ ORIJINAL -> SLUG KI PRAN AN
--
-- Yon liy pa valè distenkt. `slug_retni` NULL vle di okenn korespondans —
-- restoran sa yo rete SAN kuizin, epi se yo ki nan seksyon B.
SELECT
  'A. Kat korespondans' AS seksyon,
  r.cuisine                                AS valè_orijinal,
  public.normalize_cuisine_text(r.cuisine) AS valè_nòmalize,
  c.slug                                   AS slug_retni,
  c.name                                   AS non_afiche,
  count(*)                                 AS kantite_restoran
FROM public.restaurants r
LEFT JOIN public.restaurant_cuisines rc
  ON rc.restaurant_id = r.id AND rc.is_primary
LEFT JOIN public.cuisines c
  ON c.id = rc.cuisine_id
GROUP BY r.cuisine, public.normalize_cuisine_text(r.cuisine), c.slug, c.name
ORDER BY (c.slug IS NULL) DESC, kantite_restoran DESC, valè_orijinal;

-- ---------------------------------------------------------------------------
-- B) VALÈ KI PA MAPE — se sa ki mande yon desizyon moun.
--
-- Pou chak liy isit la: swa ajoute valè a kòm yon sinonim sou yon kuizin ki
-- egziste (UPDATE public.cuisines SET synonyms = synonyms || 'valè a'),
-- swa kreye yon nouvo kuizin. PA mete yo sou 'kreyol' paske se sa ki pi
-- komen — sa ta yon done envante.
SELECT
  'B. PA MAPE' AS seksyon,
  r.cuisine    AS valè_orijinal,
  public.normalize_cuisine_text(r.cuisine) AS valè_nòmalize,
  count(*)     AS kantite_restoran,
  string_agg(r.slug, ', ' ORDER BY r.slug) AS restoran_yo
FROM public.restaurants r
WHERE public.normalize_cuisine_text(r.cuisine) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_cuisines rc WHERE rc.restaurant_id = r.id
  )
GROUP BY r.cuisine, public.normalize_cuisine_text(r.cuisine)
ORDER BY kantite_restoran DESC;

-- ---------------------------------------------------------------------------
-- C) RESTORAN KI PA GEN OKENN VALÈ KUIZIN DITOU (`cuisine` NULL oswa vid).
--
-- Se pa yon erè backfill — pa t gen anyen pou mape. Men fòm nan pral mande
-- omwen yon kuizin, donk restoran sa yo ap bezwen youn.
SELECT
  'C. San kuizin depi nan kòmansman' AS seksyon,
  r.slug,
  r.name,
  r.status
FROM public.restaurants r
WHERE public.normalize_cuisine_text(r.cuisine) IS NULL
ORDER BY r.name;

-- ---------------------------------------------------------------------------
-- D) VERIFIKASYON ENVARYAN — chak liy isit la se yon bug.
--
-- D1: plis pase yon kuizin prensipal sou yon restoran. Endèks inik pasyèl
-- la ta dwe rann sa enposib; si yon ranje parèt, endèks la pa la.
SELECT 'D1. Plizyè kuizin prensipal' AS seksyon, restaurant_id, count(*) AS kantite
FROM public.restaurant_cuisines
WHERE is_primary
GROUP BY restaurant_id
HAVING count(*) > 1;

-- D2: yon restoran ki gen kuizin men okenn ki prensipal.
SELECT 'D2. Okenn kuizin prensipal' AS seksyon, r.slug, r.name, count(rc.*) AS kantite_kuizin
FROM public.restaurants r
JOIN public.restaurant_cuisines rc ON rc.restaurant_id = r.id
GROUP BY r.id, r.slug, r.name
HAVING count(*) FILTER (WHERE rc.is_primary) = 0;

-- D3: `restaurants.cuisine` toujou la ak valè li yo (kritè aksèptasyon 5).
SELECT 'D3. Kolòn orijinal la entak' AS seksyon,
       count(*) FILTER (WHERE cuisine IS NOT NULL) AS valè_ki_rete,
       count(*) AS total_restoran
FROM public.restaurants;
