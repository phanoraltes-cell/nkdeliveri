-- ===========================================================================
-- ODIT — EKÀ ANT DEPO A AK BAZ LA
--
-- POUKISA SCRIPT SA A EGZISTE
--
-- Migrasyon 20260914000000 la te echwe ak:
--   ERROR: 42883: function public.check_wallet_reconciliation_secure()
--          does not exist
--
-- Siyati a te kòrèk. Sa ki te fo se sipozisyon an ke tout migrasyon depo a
-- aplike nan baz la. Verifye apre sa:
--   * `public.wallet_discrepancies` -> PGRST205 « Could not find the table »
--   * `check_wallet_reconciliation_secure` -> 42883 nan editè SQL la
-- Toude soti nan MENM migrasyon an (20260827130000), epi TOUDE deklare nan
-- `src/integrations/supabase/types.ts`.
--
-- Donk `types.ts` dekri yon baz ki pa sa a. Sa fè envantè odit la fo nan DE
-- sans: li ka rate bagay ki egziste, EPI li ka liste bagay ki pa egziste.
-- `npm run check:types` detekte premye sans lan sèlman; dezyèm nan mande yon
-- lekti baz la — se sa fichye sa a bay.
--
-- ⚠ LEKTI SÈLMAN. Okenn CREATE, ALTER, DROP, GRANT, INSERT. Ou ka kouri l
--   sou pwodiksyon san okenn efè.
--
-- KIJAN POU SÈVI AK LI: kouri l, kole tout sòti a ban mwen. M ap konpare l
-- ak sa depo a deklare epi m ap bay lis migrasyon ki pa aplike yo.
-- ===========================================================================

-- 1) TAB YO KI EGZISTE TOUT BON (konpare ak 61 tab types.ts la deklare)
SELECT string_agg(c.relname, ', ' ORDER BY c.relname) AS tab_ki_egziste,
       count(*) AS total
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 2) FONKSYON YO KI EGZISTE (konpare ak 162 types.ts la deklare)
SELECT count(*) AS total_fonksyon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';

SELECT string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname) AS fonksyon_ki_egziste
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';

-- 3) TIP ENUM YO
SELECT string_agg(t.typname, ', ' ORDER BY t.typname) AS enum_ki_egziste,
       count(*) AS total
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e';

-- 4) OBJÈ MIGRASYON 20260827130000 LA — verifikasyon dirèk
SELECT 'wallet_discrepancies (tab)' AS objè,
       CASE WHEN to_regclass('public.wallet_discrepancies') IS NULL
            THEN '⚠ ABSAN' ELSE 'prezan' END AS eta
UNION ALL
SELECT 'check_wallet_reconciliation_secure (fonksyon)',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'check_wallet_reconciliation_secure')
       THEN '⚠ ABSAN' ELSE 'prezan' END
UNION ALL
SELECT 'run_wallet_reconciliation_secure (fonksyon)',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'run_wallet_reconciliation_secure')
       THEN '⚠ ABSAN' ELSE 'prezan' END;

-- 5) SI SUPABASE KENBE YON JOUNAL MIGRASYON, MEN L
--    (li ka absan si migrasyon yo kouri alamen nan editè SQL la — epi sa a
--     li menm ta eksplike ekà a)
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 40;
