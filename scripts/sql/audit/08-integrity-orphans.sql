-- ===========================================================================
-- ODIT A4 (bò baz done) — ENTEGRITE
--
-- SA L CHÈCHE :
--   A) RANJE ÒFELEN — kolòn ki sanble yon kle etranje (`*_id`) men ki PA
--      gen yon kontrent FK, epi ki pwente sou yon ranje ki pa egziste.
--      Se defo a ki pi grav nan seksyon an: san kontrent, baz la pa anpeche
--      l, epi anyen pa siyale l.
--   B) KOLÒN `*_id` SAN KONTRENT FK — kote yon relasyon egziste an pratik
--      men baz la pa fè respekte l.
--   C) INISITE KI MANKE sou chan ki dwe inik (slug restoran, nimewo
--      kòmand) — yon doub kase lojik la an silans.
--   D) DOUB REYÈL sou chan sa yo, kounye a.
--   E) TRIGGER — envantè, pou wè sa ki ap kouri dèyè do nou.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- NÒT SOU (A): rekèt la DEVINE relasyon an sou non kolòn nan
-- (`restaurant_id` -> `restaurants.id`). Se yon eristik. Yon rezilta se yon
-- PIS pou verifye alamen, pa yon vèdik.
-- ===========================================================================

-- B) KOLÒN *_id SAN FK  (fè sa a ANVAN A: li bay lis la pou A)
SELECT c.table_name AS tab, c.column_name AS kolòn,
       replace(c.column_name, '_id', '') || 's' AS tab_sipoze
FROM information_schema.columns c
JOIN pg_class pc ON pc.relname = c.table_name
JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
WHERE c.table_schema = 'public' AND pc.relkind = 'r'
  AND c.column_name LIKE '%\_id' AND c.column_name <> 'id'
  AND c.data_type = 'uuid'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f' AND k.conrelid = pc.oid AND a.attname = c.column_name
  )
ORDER BY 1, 2;

-- A) ÒFELEN sou relasyon ki gen yon FK (verifikasyon ki solid)
--    Si yon FK egziste, Postgres garanti l — sof si li `NOT VALID`.
SELECT c.conrelid::regclass AS tab, c.conname AS kontrent,
       'FK NOT VALID — ranje ki te la anvan PA verifye' AS avètisman
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.contype = 'f' AND n.nspname = 'public' AND NOT c.convalidated
ORDER BY 1;

-- C) INISITE KI MANKE sou chan kle metye yo
SELECT 'restaurants.slug' AS chan,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = ANY (x.indkey::int2[])
         WHERE x.indrelid = 'public.restaurants'::regclass AND x.indisunique AND a.attname = 'slug'
       ) THEN 'inik ✓' ELSE '⚠ PA INIK' END AS eta;

-- D) DOUB REYÈL kounye a
SELECT 'restaurants.slug' AS chan, slug AS valè, count(*) AS kantite
FROM public.restaurants GROUP BY slug HAVING count(*) > 1;

-- E) TRIGGER — envantè
SELECT c.relname AS tab, t.tgname AS trigger_non,
       CASE WHEN t.tgenabled = 'D' THEN '⚠ DEZAKTIVE' ELSE 'aktif' END AS eta,
       p.proname AS fonksyon
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
