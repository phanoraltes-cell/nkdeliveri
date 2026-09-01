-- NKD-021 — otomatizasyon retansyon pou premye 2 kategori done ki san
-- danje (Faz 11, docs/archive/phases/PHASE11_COMPLIANCE_AUDIT.md). Règ A4 leve. A5 pa
-- aplike: pa gen chanjman sou peman/estati kòmand.
--
-- Konfime deja (Faz 11): 0 otomatizasyon retansyon egziste, e pg_cron pa
-- menm parèt nan okenn migrasyon. Pwojè a deja gen yon mekanis travay
-- pwograme k ap fonksyone — Vercel Cron (vercel.json, pwoteje pa
-- CRON_SECRET, /api/cron/moncash-reconcile + /api/cron/plop-reconcile,
-- 1 fwa/jou, limit plan Vercel Hobby a). Menm patran an swiv isit la, pa
-- yon dezyèm mekanis (pg_cron), pou pa ogmante konpleksite operasyonèl la
-- san rezon.
--
-- Pòte limite eksplisitteman (owner-confirmed): sèlman 2 kategori done ki
-- pa gen okenn valè legal/kontabilite apre yon delè —
--   1. private.rate_limit_hits — grandi san limit, zewo valè apre fenèt li
--      a pase (fenèt ki pi long nan kòd la se 10 min, kòmand). 7 jou.
--   2. public.notifications — istorik notifikasyon, okenn valè legal. 90 jou.
-- orders/payments/disputes/refunds/reviews/audit_log rete san otomatizasyon
-- — menm rezònman ak NKD-020 (done finansye/odit, jamè touche pa yon travay
-- otomatik).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.run_data_retention_cleanup_secure();
--
-- Pa gen chanjman schema (ni tab, ni kolòn) — sèlman yon fonksyon —
-- BEGIN/COMMIT pa nesesè (yon sèl CREATE FUNCTION, pa gen fenèt entèmedyè
-- ki ta bezwen pwoteje kont li).

CREATE OR REPLACE FUNCTION public.run_data_retention_cleanup_secure()
RETURNS TABLE (category text, rows_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_limit_deleted bigint;
  v_notifications_deleted bigint;
BEGIN
  DELETE FROM private.rate_limit_hits WHERE window_start < now() - interval '7 days';
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.notifications WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

  RETURN QUERY VALUES
    ('rate_limit_hits', v_rate_limit_deleted),
    ('notifications', v_notifications_deleted);
END;
$$;

-- service_role sèlman — menm konvansyon egzat ak
-- complete_collect_payment_secure/flag_stale_collect_payment_secure
-- (20260731130000_moncash_collect_payments.sql,
-- 20260808200000_flag_stale_collect_payments.sql): sèl apèlan lejitim se
-- travay cron ki kouri anba service role a
-- (data-retention-cleanup.server.ts), jamè yon itilizatè otantifye.
REVOKE ALL ON FUNCTION public.run_data_retention_cleanup_secure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention_cleanup_secure() TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260819120000', 'nkd021_data_retention')
ON CONFLICT (version) DO NOTHING;
