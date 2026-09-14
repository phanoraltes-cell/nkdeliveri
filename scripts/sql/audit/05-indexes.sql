-- ===========================================================================
-- ODIT A1 (bò baz done) — ENDÈKS
--
-- SA L CHÈCHE :
--   A) endèks ki EGZAKTEMAN doub (menm tab, menm kolòn, menm lòd)
--   B) endèks ki redondan — kolòn li yo se yon PREFIKS yon lòt endèks
--      (Postgres ka sèvi ak endèks pi laj la; ti a se pwa pou anyen)
--   C) endèks ki pa janm sèvi depi dènye rdemarraj estatistik yo
--   D) kle etranje SAN endèks — kòz klasik yon `DELETE` ki pran plizyè
--      segonn sou yon tab paran
--
-- ⚠ LEKTI SÈLMAN. Okenn CREATE, DROP, ALTER. Ou ka kouri l sou pwodiksyon.
--
-- NÒT SOU (C): `idx_scan` konte depi dènye `pg_stat_reset()`. Yon endèks ki
-- gen 0 scan sou yon baz ki fèk rdemare pa mò — li jis pa ankò sèvi. Gade
-- kolòn `depi_kilè` a anvan ou konkli.
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


-- A) DOUB EGZAK
SELECT
  t.relname                AS tab,
  array_agg(i.relname ORDER BY i.relname) AS endèks_doub,
  pg_size_pretty(sum(pg_relation_size(i.oid))) AS pwa_total
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
GROUP BY t.relname, x.indrelid, x.indkey::text, x.indclass::text, x.indexprs IS NULL, x.indpred IS NULL
HAVING count(*) > 1
ORDER BY sum(pg_relation_size(i.oid)) DESC;

-- B) REDONDAN (prefiks yon lòt)
SELECT
  t.relname AS tab,
  a.relname AS endèks_ki_redondan,
  b.relname AS kouvri_pa,
  pg_size_pretty(pg_relation_size(a.oid)) AS pwa_ki_ka_libere
FROM pg_index xa
JOIN pg_class a ON a.oid = xa.indexrelid
JOIN pg_class t ON t.oid = xa.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_index xb ON xb.indrelid = xa.indrelid AND xb.indexrelid <> xa.indexrelid
JOIN pg_class b ON b.oid = xb.indexrelid
WHERE n.nspname = 'public'
  AND NOT xa.indisprimary AND NOT xa.indisunique
  AND xa.indexprs IS NULL AND xa.indpred IS NULL
  AND xb.indexprs IS NULL AND xb.indpred IS NULL
  AND array_length(xa.indkey::int2[], 1) < array_length(xb.indkey::int2[], 1)
  AND (xb.indkey::int2[])[1:array_length(xa.indkey::int2[], 1)] = xa.indkey::int2[]
ORDER BY pg_relation_size(a.oid) DESC;

-- C) JANM SÈVI
SELECT
  s.relname AS tab,
  s.indexrelname AS endèks,
  s.idx_scan AS kantite_scan,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS pwa,
  (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS depi_kilè
FROM pg_stat_user_indexes s
JOIN pg_index x ON x.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
  AND NOT x.indisprimary AND NOT x.indisunique   -- inisite se yon kontrent, pa yon optimizasyon
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- D) KLE ETRANJE SAN ENDÈKS
SELECT
  c.conrelid::regclass AS tab,
  c.conname            AS kontrent,
  (SELECT string_agg(att.attname, ', ' ORDER BY k.ord)
     FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum) AS kolòn
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index x
    WHERE x.indrelid = c.conrelid
      AND (x.indkey::int2[])[1:array_length(c.conkey, 1)] = c.conkey::int2[]
  )
ORDER BY 1, 2;
