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
-- REVOKE EKSPLISIT — an plis blòk dinamik la anwo a.
--
-- POUKISA TOUDE: blòk dinamik la ranje eta VIVAN an (li pran menm sa ki
-- rive la pa yon chemen mwen pa konnen). Deklarasyon eksplisit sa yo
-- kite yon tras GREPABLE nan istwa migrasyon an, epi se yo ki fè
-- verifikasyon estatik la (check E nan scripts/check-money-authorization
-- .mjs) kapab konfime entansyon an san yon baz done.
--
-- Se 10 fonksyon ki te fè SÈLMAN `REVOKE ... FROM PUBLIC` — sa ki pa t
-- retire dwa dirèk `anon` Supabase bay pa defo a.
REVOKE ALL ON FUNCTION public.update_restaurant_commission_secure(uuid, text, numeric, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_wallet_secure(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_restaurant_wallets_admin(text, text, text, int, int, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.get_driver_wallets_admin(text, text, text, int, int, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.get_commission_monthly_series(date, date) FROM anon;
REVOKE ALL ON FUNCTION public.get_top_restaurants_by_commission(date, date, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_top_drivers_by_commission(date, date, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_restaurant_commissions_secure(uuid, text, date, date, text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_driver_commissions_secure(uuid, text, date, date, text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.execute_commission_backfill_secure(uuid[]) FROM anon;

-- create_order_secure: DROP+CREATE nan 20260901090000 (Tach 3C) te kreye
-- yon NOUVO fonksyon, donk ALTER DEFAULT PRIVILEGES Supabase la te
-- re-bay anon EXECUTE. REVOKE ki te la a te site PUBLIC sèlman.
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid) FROM anon;
