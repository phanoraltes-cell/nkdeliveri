-- TACH 4 — FÈMEN SIFAS `anon` SOU RPC LAJAN YO.
--
-- SA VERIFIKASYON AN JWENN (scripts/sql/verify-money-authorization.sql
-- kouri sou vrè baz done a): `anon` gen EXECUTE sou 15 fonksyon lajan,
-- pami yo request_withdrawal_secure, admin_mark_requested_withdrawal_
-- paid_secure, recompute_wallet_secure, execute_commission_backfill_
-- secure, create_order_secure.
--
-- ÈSKE SE YON TWOU EKSPLWATAB? NON — mwen verifye CHAK youn: yo tout gen
-- yon gad wòl anndan (private.has_role(auth.uid(), 'admin') oswa
-- ekivalan). Pou `anon`, auth.uid() se NULL, donk yo tout leve
-- 'Forbidden'. Sa ki manke se DEZYÈM KOUCH la, pa premye a.
--
-- POUKISA LI ENPÒTAN KANMENM: konsepsyon an mande 2 kouch endepandan
-- (GRANT + gad anndan). Ak yon sèl kouch, jou yon nouvo fonksyon bliye
-- gad anndan li, `anon` rive sou li dirèkteman atravè API piblik la —
-- san okenn konekte. Nou pa kite yon sistèm lajan sou yon sèl kouch.
--
-- POUKISA SA TE RIVE: Supabase konfigire ALTER DEFAULT PRIVILEGES ki bay
-- anon/authenticated/service_role EXECUTE sou CHAK nouvo fonksyon nan
-- schema public. Yon migrasyon ki fè sèlman:
--     REVOKE ALL ON FUNCTION x() FROM PUBLIC;
-- PA retire dwa DIRÈK `anon` an — PUBLIC ak anon se 2 bagay diferan.
-- Se poutèt sa REVOKE la dwe site `anon` eksplisitman.
--
-- FÒM DINAMIK: nou pa kode yon lis fiks — nou pase sou chak fonksyon nan
-- public ki matche yon modèl lajan epi ki toujou rele pa anon. Konsa
-- migrasyon an idanpotan (li ka re-kouri san danje) epi li pran menm
-- fonksyon mwen pa konnen yo.
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND (
        p.proname LIKE '%payout%' OR p.proname LIKE '%withdrawal%'
        OR p.proname LIKE '%wallet%' OR p.proname LIKE '%topup%'
        OR p.proname LIKE '%refund%' OR p.proname LIKE '%commission%'
        OR p.proname LIKE '%order_secure%'
      )
      -- SÈL EKSEPSYON DELIBERE: checkout la montre nimewo MonCash/NatCash
      -- platfòm nan bay yon vizitè ki poko konekte. Li lekti sèlman epi
      -- done a se enfòmasyon piblik pa konsepsyon.
      AND p.proname <> 'get_platform_payout_public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon;', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC;', r.proname, r.args);
    v_count := v_count + 1;
    RAISE NOTICE 'anon revoke sou public.%(%)', r.proname, r.args;
  END LOOP;

  RAISE NOTICE 'Total fonksyon lajan ki retire nan men anon: %', v_count;
END $$;

-- ---------------------------------------------------------------------------
-- REVOKE EKSPLISIT PA NON — an plis blòk dinamik la anwo a.
--
-- POUKISA PA NON EPI PA PA SIYATI: premye vèsyon migrasyon sa a te kode
-- siyati egzat chak fonksyon. Li te echwe ak:
--     ERROR 42883: function public.create_order_secure(..., uuid) does
--     not exist
-- paske siyati create_order_secure la chanje selon ki migrasyon ki deja
-- aplike (9 agiman anvan Tach 3C, 10 apre). Yon migrasyon sekirite pa
-- dwe kraze paske yon LÒT migrasyon poko aplike — li dwe fèmen sa ki la.
--
-- Donk nou site NON yo (sa ki enpòtan an), epi nou revoke sou CHAK
-- surchaj ki reyèlman egziste. Si yon fonksyon pa la, nou pase sou li
-- an silans — pa gen anyen pou fèmen.
--
-- Makè `ANON-REVOKE:` yo se pa dekorasyon: verifikasyon estatik la
-- (check E, scripts/check-money-authorization.mjs) li yo pou l konfime
-- entansyon an san yon baz done. Kite yo.
--
-- ANON-REVOKE: update_restaurant_commission_secure
-- ANON-REVOKE: recompute_wallet_secure
-- ANON-REVOKE: get_restaurant_wallets_admin
-- ANON-REVOKE: get_driver_wallets_admin
-- ANON-REVOKE: get_commission_monthly_series
-- ANON-REVOKE: get_top_restaurants_by_commission
-- ANON-REVOKE: get_top_drivers_by_commission
-- ANON-REVOKE: get_restaurant_commissions_secure
-- ANON-REVOKE: get_driver_commissions_secure
-- ANON-REVOKE: execute_commission_backfill_secure
-- ANON-REVOKE: create_order_secure
DO $$
DECLARE
  v_name text;
  r record;
  v_total int := 0;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'update_restaurant_commission_secure',
    'recompute_wallet_secure',
    'get_restaurant_wallets_admin',
    'get_driver_wallets_admin',
    'get_commission_monthly_series',
    'get_top_restaurants_by_commission',
    'get_top_drivers_by_commission',
    'get_restaurant_commissions_secure',
    'get_driver_commissions_secure',
    'execute_commission_backfill_secure',
    'create_order_secure'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon;', v_name, r.args);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC;', v_name, r.args);
      v_total := v_total + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Revoke eksplisit aplike sou % surchaj', v_total;
END $$;
