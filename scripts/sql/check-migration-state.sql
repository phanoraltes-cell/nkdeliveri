-- KI MIGRASYON KI REYÈLMAN APLIKE? — dyagnostik lekti sèlman.
--
-- POUKISA: aplikasyon migrasyon yo fèt alamen, donk pa gen okenn tras
-- fyab sou sa ki pase. Sa deja koute nou 2 erè:
--   * 42883 (create_order_secure ... does not exist) — Tach 3C poko
--     aplike, men yon lòt migrasyon te sipoze li te la.
--   * 42723 (admin_force_credit_wallet_topup_secure already exists) —
--     yon migrasyon ki DEJA aplike te re-kouri.
--
-- Fichye sa a pa devine: li tcheke si OBJÈ chak migrasyon kreye a
-- reyèlman la. Kouri l nan Supabase SQL Editor anvan ou aplike yon
-- migrasyon, epi w ap konnen egzakteman kote ou ye.
--
-- Kouri l ankò apre — chak liy dwe di APLIKE.

WITH checks(migrasyon, sa_li_kreye, aplike) AS (
  VALUES
    ('20260901080000 — Tach 3B demann retrè',
     'payouts.requested_by',
     (SELECT count(*) > 0 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='payouts' AND column_name='requested_by')),

    ('20260901090000 — Tach 3C peye ak wallet',
     'payments.wallet_id + get_my_payable_wallets_secure',
     (SELECT count(*) > 0 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='payments' AND column_name='wallet_id')),

    ('20260901100000 — Tach 3D règ retrè',
     'tab withdrawal_rules',
     (SELECT count(*) > 0 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='withdrawal_rules')),

    ('20260902000000 — rekiperasyon rechaj + ekspirasyon san danje',
     'admin_recover_wallet_topup_secure',
     (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='admin_recover_wallet_topup_secure')),

    ('20260902010000 — kredi manyèl rechaj',
     'admin_force_credit_wallet_topup_secure',
     (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='admin_force_credit_wallet_topup_secure')),

    ('20260902020000 — koreksyon ON CONFLICT (KRITIK)',
     'endèks idempotency_key SAN predika',
     (SELECT count(*) > 0 FROM pg_indexes
       WHERE schemaname='public'
         AND indexname='wallet_transactions_idempotency_key_uniq'
         AND indexdef NOT ILIKE '%WHERE%')),

    ('20260903000000 — fèmen sifas anon',
     'anon pa gen EXECUTE sou RPC lajan',
     (SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND has_function_privilege('anon', p.oid, 'EXECUTE')
         AND (p.proname LIKE '%payout%' OR p.proname LIKE '%withdrawal%'
              OR p.proname LIKE '%wallet%' OR p.proname LIKE '%topup%'
              OR p.proname LIKE '%refund%' OR p.proname LIKE '%commission%'
              OR p.proname LIKE '%order_secure%')
         AND p.proname <> 'get_platform_payout_public'))
)
SELECT
  migrasyon,
  sa_li_kreye,
  CASE WHEN aplike THEN 'APLIKE' ELSE '>>> POKO APLIKE <<<' END AS eta
FROM checks;
