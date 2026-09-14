-- ===========================================================================
-- ROLLBACK — 20260914000000_revoke_unused_rpc_grants.sql
--
-- ⚠ PA KOURI FICHYE SA A NAN YON DEPLWAMAN NÒMAL. Li la SÈLMAN pou defè
--   revoke yo si yon ekran vin bezwen youn nan fonksyon sa yo.
--
-- Li remete EGZAKTEMAN grant ki te la anvan, jan migrasyon orijinal chak
-- fonksyon te deklare yo — pa yon grant pi laj:
--
--   charge_restaurant_monthly_fee_secure  -> authenticated
--   check_wallet_reconciliation_secure    -> authenticated
--   get_restaurant_payout_public          -> authenticated
--   get_restaurants_missing_hours_admin   -> authenticated
--   log_ad_event_secure                   -> anon, authenticated
--
-- ⚠ SOU `log_ad_event_secure` ESPESYALMAN: pa remete grant `anon` an san yon
--   limit debi. Fonksyon an ekri nan `sponsored_placement_events` epi li
--   enkremante `impressions`/`clicks` san okenn plafon. Si ou vann
--   emplasman esponsorize, chif sa yo vin fakturab — epi jan yo ye la a
--   nenpòt moun ka fabrike yo.
-- ===========================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.charge_restaurant_monthly_fee_secure(uuid, date)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.check_wallet_reconciliation_secure()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_restaurants_missing_hours_admin()
  TO authenticated;

-- Wè avètisman an pi wo anvan ou dekòmante liy sa a.
-- GRANT EXECUTE ON FUNCTION public.log_ad_event_secure(uuid, text, text, text)
--   TO anon, authenticated;

COMMIT;
