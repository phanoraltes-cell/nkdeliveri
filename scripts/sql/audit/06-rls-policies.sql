-- ===========================================================================
-- ODIT A2 (bò baz done) — RLS AK RÈGLEMAN
--
-- SA L CHÈCHE :
--   A) tab ki PA GEN RLS aktive — se pi gwo risk la: si wout la pa gade,
--      done a nu
--   B) tab ki gen RLS aktive MEN okenn règleman — pèsonn pa ka li anyen
--      (paj vid pou tout moun), sof `service_role`
--   C) règleman ki bay tout moun dwa (`USING (true)`) — chak youn dwe
--      jistifye; sou yon tab piblik li nòmal, sou yon tab done kliyan non
--   D) règleman ki pa ka janm vre (`USING (false)`) — kòd mò
--   E) tout règleman yo, gwoupe, pou gade an blòk
--   F) dwa `anon`/`authenticated` sou tab yo, DIRÈKTEMAN (san pase pa RPC)
--
-- ⚠ LEKTI SÈLMAN. Okenn ALTER, CREATE POLICY, GRANT. Sou pwodiksyon san
--   danje.
--
-- KIJAN POU LI: seksyon A ak F se sa ki konte. Yon tab nan A ki gen done
-- kliyan se yon konsta grav. Nan F, `anon` ki gen INSERT/UPDATE/DELETE sou
-- yon tab se yon sifas ekriti piblik — chak youn dwe gen yon rezon.
-- ===========================================================================

-- ⚠ FICHYE SA A GEN PLIZYÈ REKÈT.
--
--   Editè SQL Supabase la montre SÈLMAN dènye jeu rezilta a. Si ou kole
--   tout fichye a yon sèl kou, ou pral wè dènye rekèt la epi rès la ap
--   envizib — san okenn mesaj pou di w sa.
--
--   KOURI CHAK REKÈT YON PA YON (chak blòk ki fini ak `;`), epi kole chak
--   rezilta apa. Sinon voye yo nan yon sèl `jsonb_build_object` jan
--   02-payouts-disputed.sql fè a.


-- A) TAB SAN RLS
SELECT c.relname AS tab,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS pwa,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS kantite_règleman
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY pg_total_relation_size(c.oid) DESC;

-- B) RLS AKTIVE MEN OKENN RÈGLEMAN
SELECT c.relname AS tab
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
ORDER BY 1;

-- C) RÈGLEMAN KI TOUJOU VRE
SELECT schemaname AS skema, tablename AS tab, policyname AS règleman,
       cmd AS operasyon, roles AS wòl, qual AS kondisyon_lekti,
       with_check AS kondisyon_ekriti
FROM pg_policies
WHERE schemaname = 'public'
  AND (btrim(coalesce(qual, '')) = 'true' OR btrim(coalesce(with_check, '')) = 'true')
ORDER BY tablename, policyname;

-- D) RÈGLEMAN KI PA KA JANM VRE (kòd mò)
SELECT tablename AS tab, policyname AS règleman, cmd AS operasyon,
       qual AS kondisyon_lekti, with_check AS kondisyon_ekriti
FROM pg_policies
WHERE schemaname = 'public'
  AND (btrim(coalesce(qual, '')) = 'false' OR btrim(coalesce(with_check, '')) = 'false')
ORDER BY tablename, policyname;

-- E) TOUT RÈGLEMAN YO, AN BLÒK
SELECT tablename AS tab, count(*) AS kantite,
       string_agg(DISTINCT cmd, ', ' ORDER BY cmd) AS operasyon_kouvri
FROM pg_policies WHERE schemaname = 'public'
GROUP BY tablename ORDER BY tablename;

-- F) DWA DIRÈK SOU TAB YO POU anon / authenticated
SELECT table_name AS tab, grantee AS wòl,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS dwa
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
GROUP BY table_name, grantee
ORDER BY
  (CASE WHEN grantee = 'anon' THEN 0 ELSE 1 END),
  (CASE WHEN string_agg(privilege_type, ',') LIKE '%INSERT%'
         OR string_agg(privilege_type, ',') LIKE '%UPDATE%'
         OR string_agg(privilege_type, ',') LIKE '%DELETE%' THEN 0 ELSE 1 END),
  table_name;
