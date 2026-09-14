-- ===========================================================================
-- REVOKE SOU SENK RPC KI PA GEN OKENN APELAN
--
-- Odit A1 (seksyon « sifas ekzekitab ») te konfwonte fonksyon `public` yo ak
-- tout `src/`. Rechèch la te fèt sou NON YO KÒM CHÈN, pa kòm enpòtasyon,
-- paske `supabase.rpc("non_fonksyon")` pa sanble yon import — se konsa yon
-- fonksyon ka parèt mò alòske li vivan.
--
-- Sis fonksyon pa t gen okenn apelan: ni nan `src/`, ni nan yon lòt fonksyon
-- SQL, ni nan yon `cron.schedule`. Senk nan yo pase isit la.
--
-- ---------------------------------------------------------------------------
-- POUKISA SIYATI YO PA EKRI AN DI (KOREKSYON — premye vèsyon an te echwe)
--
-- Premye vèsyon migrasyon sa a te liste chak siyati alamen:
--
--   REVOKE EXECUTE ON FUNCTION public.check_wallet_reconciliation_secure() …
--
-- Li te echwe ak:
--
--   ERROR: 42883: function public.check_wallet_reconciliation_secure()
--          does not exist
--
-- Siyati a te KÒRÈK (menm bagay nan
-- 20260827130000_audit_remediation_dead_grant_and_reconciliation.sql:84 ak
-- nan types.ts). Sa ki pa t kòrèk se sipozisyon an: mwen te sipoze tout
-- migrasyon depo a aplike nan baz sa a. Yo pa. Verifye:
--
--   * `public.wallet_discrepancies` (menm migrasyon an, liy 34) -> PGRST205
--     « Could not find the table » — tab la PA EGZISTE.
--   * `check_wallet_reconciliation_secure` -> 42883 nan editè SQL la.
--
-- Donk migrasyon 20260827130000 la pa janm aplike sou baz sa a, pandan
-- `types.ts` deklare toude objè yo. Se yon konsta apa, epi li pi grav pase
-- erè a (wè nòt nan fen fichye a).
--
-- Leson an: yon migrasyon ki gen dwa kouri sou yon baz yon ajan pa ka wè PA
-- DWE ekri siyati an di. Li dwe mande baz la sa ki EGZISTE. Se sa vèsyon sa
-- a fè: li li `pg_proc`, li revoke sou CHAK sichaj ki la, epi yon fonksyon
-- ki absan pa fè l tonbe — li jis pa gen anyen pou revoke.
--
-- Benefis an plis: si yon fonksyon gen plizyè sichaj (ka
-- `get_restaurant_payout_public`, redefini plizyè fwa), yo TOUT revoke. Yon
-- lis alamen t ap kite yon sichaj ak dwa li.
--
-- ---------------------------------------------------------------------------
-- SA MIGRASYON SA A PA FÈ
--
-- 1) Li PA efase okenn fonksyon. Yon `REVOKE` retire aksè; yon `DROP` retire
--    travay la. Efasman se yon dezyèm etap, apre yon sik konplè san apèl.
--
-- 2) Li PA touche `resolve_payout_dispute_secure`, ki te sizyèm lan.
--    Rezon an: se pa yon sifas mò, se SÈL SÒTI yon eta yon moun ka antre
--    ladan l. `dispute_payout_secure` rele nan
--    src/components/order/payout-confirm-section.tsx:82 — yon restoratè
--    oswa yon livrè ka konteste yon vèsman — epi
--    `resolve_payout_dispute_secure` se sèl kòd ki ekri `status='resolved'`.
--    Pandan tan sa a lajan an rete nan `pending_balance`: ni peye, ni
--    disponib. Revoke l ta sele kul-de-sak la olye korije l.
--
-- 3) Li PA modifye okenn done. Okenn `INSERT`, `UPDATE`, `DELETE`, okenn DDL
--    sou yon tab. Sèlman pèmisyon sou fonksyon.
--
-- ---------------------------------------------------------------------------
-- POUKISA CHAK YOUN — epi sa konstat la ye
--
-- Kat nan senk yo se FONKSYONALITE KI POKO BRANCHE, pa rezidi:
--
--   charge_restaurant_monthly_fee_secure
--     Fakti frè mansyèl yon restoran. `commission_entry_type` gen valè
--     `monthly_fee`, men chèn nan pa parèt okenn kote nan `src/`. Donk okenn
--     frè mansyèl pa janm faktire. REVENI KI PA KOLEKTE.
--
--   check_wallet_reconciliation_secure
--     Dyagnostik sou `wallet_discrepancies`. Wè pi wo: ni li ni tab li a pa
--     egziste nan baz sa a.
--
--   get_restaurants_missing_hours_admin
--     Lis restoran san orè, pou admin. Okenn ekran. (Sa a EGZISTE byen nan
--     baz la — REST bay 42501 Forbidden, ki vle di li jwenn li.)
--
--   get_restaurant_payout_public
--     Jimo `get_platform_payout_public`, ki LI MENM rele nan `src/`. Sèl la
--     nan senk yo ki sanble yon vrè rezidi.
--
--   log_ad_event_secure
--     Konte enpresyon/klik sou anons esponsorize. Gad yo kòrèk sou sa yo
--     kouvri (SECURITY DEFINER, search_path fiks, lis blan sou
--     `_event_type`, anons dwe egziste) MEN pa gen okenn limit debi ni
--     idanpotans, EPI li te bay `anon`. Nenpòt moun ka boukle l pou anfle
--     `impressions`/`clicks` epi pou plen `sponsored_placement_events`.
--     Sa ki limite domaj la jodi a: okenn kòd pa rele l, okenn ekran pa
--     afiche kontè yo, okenn fakturasyon pa depann de yo. Lè mezi a branche,
--     li dwe retounen AK yon limit debi.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  v_names CONSTANT text[] := ARRAY[
    'charge_restaurant_monthly_fee_secure',
    'check_wallet_reconciliation_secure',
    'get_restaurant_payout_public',
    'get_restaurants_missing_hours_admin',
    'log_ad_event_secure'
  ];
  r record;
  v_revoke integer := 0;
  v_jwenn text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (v_names)
    ORDER BY p.proname, args
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, authenticated',
      r.proname, r.args
    );
    v_revoke := v_revoke + 1;
    v_jwenn := v_jwenn || (r.proname || '(' || r.args || ')');
    RAISE NOTICE 'REVOKE -> public.%(%)', r.proname, r.args;
  END LOOP;

  RAISE NOTICE '--- % siyati revoke sou % non chèche ---', v_revoke, array_length(v_names, 1);

  -- Yon fonksyon ki absan PA yon erè: baz sa a pa gen tout migrasyon depo a
  -- (wè antèt la). Men nou di l klèman, paske « absan » ak « revoke » se de
  -- rezilta diferan epi yon silans ta melanje yo.
  FOR r IN
    SELECT unnest(v_names) AS nom
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = r.nom
    ) THEN
      RAISE NOTICE 'ABSAN (anyen pou revoke) -> public.%', r.nom;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ===========================================================================
-- VERIFIKASYON APRE OU KOURI L — okenn liy pa dwe soti:
--
--   SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS siyati,
--          a.rolname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated']) AS rolname) a
--   WHERE n.nspname = 'public'
--     AND p.proname IN (
--       'charge_restaurant_monthly_fee_secure',
--       'check_wallet_reconciliation_secure',
--       'get_restaurant_payout_public',
--       'get_restaurants_missing_hours_admin',
--       'log_ad_event_secure')
--     AND has_function_privilege(a.rolname, p.oid, 'EXECUTE');
--
-- ---------------------------------------------------------------------------
-- KONSTA APA, KI PI GRAV PASE ERÈ A
--
-- `wallet_discrepancies` ak de fonksyon rekonsilyasyon bous yo PA EGZISTE
-- nan baz sa a, alòske `src/integrations/supabase/types.ts` deklare yo. Sa
-- vle di migrasyon 20260827130000 (remedyasyon odit sou entegrite bous) pa
-- janm aplike. Kontwòl `npm run check:types` la detekte sans « nan migrasyon
-- men pa nan tip yo »; li PA ka detekte sans sa a — « nan tip yo men pa nan
-- baz la » — san yon aksè baz done.
--
-- Pou wè lis konplè a, kouri:
--   scripts/sql/audit/09-migration-drift.sql
-- ===========================================================================
