-- ===========================================================================
-- REVOKE SOU SENK RPC KI PA GEN OKENN APELAN
--
-- Odit A1 (seksyon « sifas ekzekitab ») te konfwonte 162 fonksyon `public`
-- yo ak tout `src/`. Rechèch la te fèt sou NON YO KÒM CHÈN, pa kòm enpòtasyon,
-- paske `supabase.rpc("non_fonksyon")` pa sanble yon import — se konsa yon
-- fonksyon ka parèt mò alòske li vivan.
--
-- Sis fonksyon pa t gen okenn apelan: ni nan `src/`, ni nan yon lòt fonksyon
-- SQL, ni nan yon `cron.schedule`. Senk nan yo pase isit la.
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
--    disponib. Revoke l ta sele kul-de-sak la olye korije l. Li mande yon
--    bouton abitraj nan ekran admin vèsman yo, pa yon REVOKE.
--
-- 3) Li PA modifye okenn done. Okenn `INSERT`, `UPDATE`, `DELETE`, okenn DDL
--    sou yon tab. Sèlman pèmisyon sou fonksyon.
--
-- ---------------------------------------------------------------------------
-- POUKISA CHAK YOUN — epi sa konstat la ye
--
-- Kat nan senk yo se FONKSYONALITE KI POKO BRANCHE, pa rezidi. Se yon
-- konstat, pa yon netwayaj: yon moun te ekri travay la epi entèfas la pa
-- janm vini. Revoke a fèmen sifas la an atandan; li pa ranplase travay ki
-- rete a.
--
--   charge_restaurant_monthly_fee_secure(uuid, date)
--     Fakti frè mansyèl yon restoran. `commission_entry_type` gen valè
--     `monthly_fee`, men chèn nan pa parèt okenn kote nan `src/`
--     (`grep -rn monthly_fee src/ --exclude types.ts` = vid). Donk okenn
--     frè mansyèl pa janm faktire depi aplikasyon an. REVENI KI PA KOLEKTE.
--
--   check_wallet_reconciliation_secure()
--     Dyagnostik admin sou `wallet_discrepancies`, kreye pa
--     20260827130000_audit_remediation_dead_grant_and_reconciliation.sql.
--     Okenn ekran pa rele l — donk zouti rekonsilyasyon an egziste men
--     pèsonn pa ka kouri l.
--
--   get_restaurants_missing_hours_admin()
--     Lis restoran san orè, pou admin. Okenn ekran.
--
--   get_restaurant_payout_public(uuid)
--     Jimo `get_platform_payout_public(uuid)`, ki LI MENM rele nan `src/`.
--     Sanble depase pa jimo a. Sèl la nan senk yo ki sanble yon vrè rezidi.
--
--   log_ad_event_secure(uuid, text, text, text)
--     Konte enpresyon/klik sou anons esponsorize. Ka a mande atansyon:
--       * li se SECURITY DEFINER ak `SET search_path = public`, li valide
--         `_event_type` kont yon lis blan, epi li egzije anons lan egziste —
--         gad sa yo kòrèk;
--       * MEN li pa gen okenn limit debi ni okenn idanpotans, EPI li te bay
--         `anon`. Nenpòt moun ka boukle l pou anfle `impressions`/`clicks`
--         epi pou plen `sponsored_placement_events`.
--       * Sa ki limite domaj la jodi a: okenn kòd pa rele l, okenn ekran pa
--         afiche kontè yo, okenn fakturasyon pa depann de yo (verifye sou
--         dashboard.admin.ads.tsx ak components/ads/).
--     Donk anons yo afiche epi ANYEN pa mezire. Lè mezi a branche, li dwe
--     retounen AK yon limit debi — pa jan li ye la a, sinon chif ou vann
--     bay yon patnè se chif nenpòt moun ka fabrike.
--
-- ===========================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.charge_restaurant_monthly_fee_secure(uuid, date)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.check_wallet_reconciliation_secure()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_restaurants_missing_hours_admin()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_ad_event_secure(uuid, text, text, text)
  FROM anon, authenticated;

COMMIT;

-- ===========================================================================
-- VERIFIKASYON APRE OU KOURI L — okenn liy pa dwe soti:
--
--   SELECT p.proname, a.rolname
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
-- POU DEFÈ L (si yon ekran bezwen youn ankò):
--   supabase/migrations/rollback/20260914000000_revoke_unused_rpc_grants_rollback.sql
-- ===========================================================================
