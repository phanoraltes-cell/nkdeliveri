-- ===========================================================================
-- ROLLBACK — 20260914000000_revoke_unused_rpc_grants.sql
--
-- ⚠ PA KOURI FICHYE SA A NAN YON DEPLWAMAN NÒMAL. Li la SÈLMAN pou defè
--   revoke yo si yon ekran vin bezwen youn nan fonksyon sa yo.
--
-- Li remete grant `authenticated` la sou kat fonksyon. Li PA remete grant
-- `anon` sou `log_ad_event_secure` — wè avètisman an anba a.
--
-- ---------------------------------------------------------------------------
-- MENM KOREKSYON AK MIGRASYON ALE A
--
-- Premye vèsyon fichye sa a te liste siyati yo alamen epi li te echwe ak:
--
--   ERROR: 42883: function public.check_wallet_reconciliation_secure()
--          does not exist
--
-- Siyati a te kòrèk; sa ki pa t kòrèk se sipozisyon an ke tout migrasyon
-- depo a aplike nan baz la. Yo pa: `wallet_discrepancies` ak de fonksyon
-- rekonsilyasyon bous yo absan (migrasyon 20260827130000 pa janm kouri).
--
-- Donk isit la tou nou mande baz la sa ki egziste olye nou sipoze l. Yon
-- fonksyon ki absan pa fè fichye a tonbe — li jis pa gen anyen pou grant.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  -- `log_ad_event_secure` PA ladan l eksprè. Wè avètisman an anba a.
  v_names CONSTANT text[] := ARRAY[
    'charge_restaurant_monthly_fee_secure',
    'check_wallet_reconciliation_secure',
    'get_restaurant_payout_public',
    'get_restaurants_missing_hours_admin'
  ];
  r record;
  v_grant integer := 0;
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
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
      r.proname, r.args
    );
    v_grant := v_grant + 1;
    RAISE NOTICE 'GRANT -> public.%(%) TO authenticated', r.proname, r.args;
  END LOOP;

  RAISE NOTICE '--- % siyati remèt ---', v_grant;
END $$;

COMMIT;

-- ===========================================================================
-- ⚠ SOU `log_ad_event_secure`: pa remete grant `anon` an san yon limit debi.
--
-- Fonksyon an ekri nan `sponsored_placement_events` epi li enkremante
-- `impressions`/`clicks` san okenn plafon ni idanpotans. Si ou vann
-- emplasman esponsorize, chif sa yo vin fakturab — epi jan yo ye la a
-- nenpòt moun ka fabrike yo nan yon boukl.
--
-- Si ou VLE remete l kanmenm, dekòmante blòk sa a:
--
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'log_ad_event_secure'
--   LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated',
--                    r.proname, r.args);
--   END LOOP;
-- END $$;
-- ===========================================================================
