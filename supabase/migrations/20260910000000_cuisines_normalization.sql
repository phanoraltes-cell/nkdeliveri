-- ===========================================================================
-- NÒMALIZASYON `restaurants.cuisine` — TAB REFERANS + RELASYON M2M
-- ===========================================================================
-- Pwoblèm nan: `restaurants.cuisine` se tèks lib. Sou de restoran ki nan
-- pwodiksyon kounye a:
--
--     nk-food     ->  'kreyol'
--     gou-laky    ->  'Manje kreyol '      <- majiskil, mo anplis, espas final
--
-- Menm kuizin nan, de ekriti. Chak nouvo restoratè ajoute yon variyant.
--
-- Migrasyon sa a KREYE estrikti a epi li ranpli l. Li PA touche kòd
-- aplikasyon an, epi li PA efase anyen.
--
-- ---------------------------------------------------------------------------
-- SA MIGRASYON SA A PA FÈ (eksprè)
--
--   * Li PA efase ni chanje non `restaurants.cuisine`. Kolòn nan rete la ak
--     valè orijinal li yo — se sèl fason pou nou ka retounen an aryè san
--     pèdi anyen, epi kritè aksèptasyon 5 la mande sa.
--   * Li PA kreye okenn paj `/kategori/<slug>` ni antre sitemap.
--   * Li PA gen okenn `DROP`. Rollback la nan yon fichye apa:
--     supabase/migrations/rollback/20260910000000_cuisines_normalization_rollback.sql
--
-- ---------------------------------------------------------------------------
-- IDANPOTAN: `IF NOT EXISTS` toupatou, `ON CONFLICT DO NOTHING` sou seed la,
-- epi backfill la sèlman touche restoran ki PA gen okenn kuizin (wè §5).
-- Kouri l de fwa youn dèyè lòt pa chanje anyen apre premye fwa a.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) `unaccent` — pou konpare 'kreyòl' ak 'kreyol' kòm menm bagay.
--
-- Menm konvansyon ak `pgcrypto` nan 20260702234435: schema `extensions`.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) Fonksyon nòmalizasyon an — yon sèl definisyon, sèvi nan backfill la,
--    nan rapò a, epi pita nan rechèch la.
--
-- STABLE, pa IMMUTABLE: `unaccent(text)` ak yon sèl agiman depann de
-- diksyonè aktif la, donk Postgres klase l STABLE. Nou pa sèvi ak li nan
-- yon endèks, donk sa ase.
CREATE OR REPLACE FUNCTION public.normalize_cuisine_text(_raw text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  -- Lòd la konte: btrim anvan, apre sa aksan, apre sa miniskil, epi nan
  -- fen an redwi tout espas miltip (ki ka rete nan mitan) a yon sèl.
  SELECT nullif(regexp_replace(lower(unaccent(btrim(_raw))), '\s+', ' ', 'g'), '');
$$;

COMMENT ON FUNCTION public.normalize_cuisine_text(text) IS
  'Nòmalize yon valè kuizin tèks lib pou konparezon: trim, san aksan, miniskil, espas miltip redwi. Retounen NULL pou yon chèn vid.';

-- ---------------------------------------------------------------------------
-- 2) `cuisines` — lis fèmen an.
CREATE TABLE IF NOT EXISTS public.cuisines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  -- Sèvi nan backfill la ak nan rechèch. Yo pa bezwen nòmalize nan tab la:
  -- konparezon an nòmalize de bò yo (wè §5).
  synonyms text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Slug yo ap vin URL yon jou. Kontrent la anpeche yon admin antre yon slug
-- ak yon aksan, yon espas oswa yon majiskil — sa ta bay yon URL ki kase.
ALTER TABLE public.cuisines DROP CONSTRAINT IF EXISTS cuisines_slug_format;
ALTER TABLE public.cuisines ADD CONSTRAINT cuisines_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

COMMENT ON COLUMN public.cuisines.slug IS
  'ASCII, san aksan, STAB — pa janm chanje apre kreyasyon, li vin yon URL. Non afiche a (`name`) se sa ki modifyab.';

-- ---------------------------------------------------------------------------
-- 3) `restaurant_cuisines` — relasyon plizyè-a-plizyè.
--
-- Rezon M2M (desizyon Altes): « Gou Laky » fè kreyòl AK fritay; yon sèl
-- `cuisine_id` ta oblije l chwazi.
CREATE TABLE IF NOT EXISTS public.restaurant_cuisines (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- RESTRICT, pa CASCADE, sou cuisine_id — WÈ NÒT NAN MESAJ LIVREZON AN.
  -- Spec la di « on delete cascade » san presize ki kle. Sou restaurant_id
  -- CASCADE klè: efase yon restoran efase lyen li yo. Sou cuisine_id yon
  -- CASCADE ta vle di efase yon kuizin retire l an silans sou chak restoran
  -- ki genyen l — sa kontredi pwen 6 la (« Pas de suppression — la
  -- désactivation suffit et préserve les liaisons existantes »). RESTRICT
  -- fè yon efasman echwe olye li detwi done an silans.
  cuisine_id uuid NOT NULL REFERENCES public.cuisines(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, cuisine_id)
);

-- OMWEN YON SÈL kuizin prensipal pa restoran. Endèks inik PASYÈL: li
-- aplike sèlman sou ranje kote `is_primary` vre, donk yon restoran ka gen
-- otan kuizin segondè li vle.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_cuisines_one_primary_idx
  ON public.restaurant_cuisines (restaurant_id)
  WHERE is_primary;

-- Lekti pa kuizin (paj kategori pita, filtè kounye a).
CREATE INDEX IF NOT EXISTS restaurant_cuisines_cuisine_idx
  ON public.restaurant_cuisines (cuisine_id);

-- ---------------------------------------------------------------------------
-- 4) Seed — 8 kuizin v1 yo.
--
-- `ON CONFLICT (slug) DO NOTHING`: yon dezyèm egzekisyon pa touche anyen,
-- epi li pa ekrase yon `name` oswa yon `sort_order` yon admin ta deja
-- chanje nan ekran administrasyon an.
INSERT INTO public.cuisines (slug, name, synonyms, sort_order) VALUES
  ('kreyol', 'Manje kreyòl',
   ARRAY['kreyol','kreyòl','manje kreyol','manje kreyòl','kreyol ayisyen','creole','cuisine créole','haitian'], 1),
  ('fritay', 'Fritay',
   ARRAY['fritay','friture','fritures'], 2),
  ('fast-food', 'Fast-food',
   ARRAY['fast food','fastfood','burger','hamburger','sandwich'], 3),
  ('lanme', 'Manje lanmè',
   ARRAY['lanme','lanmè','manje lanmè','fruits de mer','seafood','pwason','poisson'], 4),
  ('pizza', 'Pizza',
   ARRAY['pizza','pizzeria','pizzas'], 5),
  ('bwason', 'Bwason & ji',
   ARRAY['bwason','ji','jus','boisson','boissons','drinks','bar'], 6),
  ('dese', 'Desè & patisri',
   ARRAY['dese','desè','dessert','desserts','patisri','pâtisserie','gato','gâteau'], 7),
  ('bekery', 'Boulanjri',
   ARRAY['bekery','boulanjri','boulangerie','bakery','pen','pain'], 8)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) BACKFILL.
--
-- Twa gad ki fè operasyon sa a san danje:
--
--   a) `WHERE NOT EXISTS (... rc.restaurant_id = r.id)` — nou touche SÈLMAN
--      restoran ki poko gen okenn kuizin. Sa fè de bagay: migrasyon an
--      re-kourab, EPI si yon restoratè korije chwa li apre, yon dezyèm
--      egzekisyon pa ekrase travay li.
--
--   b) `DISTINCT ON (r.id)` ak `ORDER BY r.id, c.sort_order` — yon valè ka
--      matche plizyè kuizin (yon jou yon sinonim ka pataje). San sa, nou ta
--      eseye mete DE ranje `is_primary = true` pou menm restoran an epi
--      endèks inik la ta fè tout migrasyon an echwe. Nou pran youn, epi
--      chwa a deterministik (pi ba `sort_order`).
--
--   c) OKENN DEVINÈT. Si valè a pa matche ni yon slug ni yon sinonim,
--      restoran an rete SAN kuizin epi li parèt nan rapò a. Nou pa mete l
--      sou 'kreyol' paske se sa ki pi komen — sa ta yon done envante.
INSERT INTO public.restaurant_cuisines (restaurant_id, cuisine_id, is_primary)
SELECT DISTINCT ON (r.id) r.id, c.id, true
FROM public.restaurants r
JOIN public.cuisines c
  ON public.normalize_cuisine_text(r.cuisine) = c.slug
  OR EXISTS (
       SELECT 1
       FROM unnest(c.synonyms) AS s
       WHERE public.normalize_cuisine_text(s) = public.normalize_cuisine_text(r.cuisine)
     )
WHERE public.normalize_cuisine_text(r.cuisine) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_cuisines rc WHERE rc.restaurant_id = r.id
  )
ORDER BY r.id, c.sort_order
ON CONFLICT (restaurant_id, cuisine_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) RLS.
--
-- Aliyen sou `restaurants` (20260702234435): lekti piblik pou sa ki vizib,
-- ekriti pou pwopriyetè a oswa yon admin. Politik yo sèvi ak
-- `public.has_role` — se konvansyon POLITIK la nan pwojè a
-- (`private.has_role` se pou anndan yon fonksyon SECURITY DEFINER).
--
-- `DROP POLICY IF EXISTS` anvan chak `CREATE`: PostgreSQL PA gen
-- `CREATE POLICY IF NOT EXISTS` (erè 42710 nou te deja fè fas).

ALTER TABLE public.cuisines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuisines FROM PUBLIC;
GRANT SELECT ON public.cuisines TO anon, authenticated;
GRANT ALL ON public.cuisines TO service_role;

DROP POLICY IF EXISTS "cuisines public read" ON public.cuisines;
CREATE POLICY "cuisines public read" ON public.cuisines
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "cuisines admin insert" ON public.cuisines;
CREATE POLICY "cuisines admin insert" ON public.cuisines
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "cuisines admin update" ON public.cuisines;
CREATE POLICY "cuisines admin update" ON public.cuisines
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

-- PA GEN POLITIK DELETE — pwen 6 spec la: dezaktivasyon, pa efasman. San
-- yon politik DELETE, RLS refize chak efasman pou tout wòl ki pase pa li.

ALTER TABLE public.restaurant_cuisines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_cuisines FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_cuisines TO authenticated;
GRANT SELECT ON public.restaurant_cuisines TO anon;
GRANT ALL ON public.restaurant_cuisines TO service_role;

DROP POLICY IF EXISTS "restaurant_cuisines public read" ON public.restaurant_cuisines;
CREATE POLICY "restaurant_cuisines public read" ON public.restaurant_cuisines
  FOR SELECT USING (true);

-- Yon restoratè ekri SÈLMAN sou pwòp restoran li. Menm kondisyon egzat ak
-- politik UPDATE `restaurants` la.
DROP POLICY IF EXISTS "restaurant_cuisines owner insert" ON public.restaurant_cuisines;
CREATE POLICY "restaurant_cuisines owner insert" ON public.restaurant_cuisines
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND (r.owner_id = auth.uid()
             OR public.has_role(auth.uid(), 'admin')
             OR public.has_role(auth.uid(), 'super_admin'))
    )
  );

DROP POLICY IF EXISTS "restaurant_cuisines owner update" ON public.restaurant_cuisines;
CREATE POLICY "restaurant_cuisines owner update" ON public.restaurant_cuisines
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND (r.owner_id = auth.uid()
             OR public.has_role(auth.uid(), 'admin')
             OR public.has_role(auth.uid(), 'super_admin'))
    )
  );

DROP POLICY IF EXISTS "restaurant_cuisines owner delete" ON public.restaurant_cuisines;
CREATE POLICY "restaurant_cuisines owner delete" ON public.restaurant_cuisines
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND (r.owner_id = auth.uid()
             OR public.has_role(auth.uid(), 'admin')
             OR public.has_role(auth.uid(), 'super_admin'))
    )
  );

COMMIT;

-- ===========================================================================
-- APRE OU KOURI SA A: kouri rapò a AVAN nenpòt lòt bagay —
--   scripts/sql/cuisine-backfill-report.sql
-- Rezilta ki atann sou done aktyèl yo: 'kreyol' ak 'Manje kreyol ' toude
-- sou slug `kreyol`, ZEWO valè ki pa mape.
-- ===========================================================================
