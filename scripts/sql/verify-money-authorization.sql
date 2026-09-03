-- TACH 4 — VERIFIKASYON OTORIZASYON LAJAN SOU VRÈ BAZ DONE A
--
-- Kouri fichye sa a nan Supabase SQL Editor. Li PA modifye anyen (lekti
-- sèlman). Li retounen yon liy pa verifikasyon ak PASS/FAIL.
--
-- POUKISA LI EGZISTE: tès otomatik yo (src/lib/__tests__/money-
-- authorization.test.ts) verifye sa MIGRASYON yo deklare. Fichye sa a
-- verifye sa ki REYÈLMAN deplwaye — yo pa menm bagay si yon moun te fè
-- yon chanjman alamen nan dashbòd Supabase la.
--
-- REZILTA KI ATANN: chak liy = PASS. Nenpòt FAIL se yon twou sekirite
-- ki dwe fèmen anvan pwodiksyon.

WITH money_tables(t) AS (
  VALUES ('wallets'), ('wallet_transactions'), ('payouts'), ('payout_commissions'),
         ('payment_intents'), ('commission_ledger'), ('payments'), ('withdrawal_rules')
),
service_role_only(fn) AS (
  VALUES ('complete_pending_payout_secure'), ('fail_pending_payout_secure'),
         ('complete_wallet_topup_secure'), ('expire_stale_wallet_topups_secure'),
         ('complete_collect_payment_secure')
),

-- A) `anon` pa dwe ka egzekite okenn RPC ki deplase lajan.
check_a AS (
  SELECT
    'A. anon pa ka rele okenn RPC lajan' AS verifikasyon,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS rezilta,
    COALESCE(string_agg(p.proname, ', '), 'okenn') AS detay
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
),

-- B) RPC service_role SÈLMAN pa dwe rele pa yon sesyon konekte.
check_b AS (
  SELECT
    'B. RPC service_role pa rele pa authenticated' AS verifikasyon,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS rezilta,
    COALESCE(string_agg(p.proname, ', '), 'okenn') AS detay
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN service_role_only s ON s.fn = p.proname
  WHERE n.nspname = 'public'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
),

-- C) Chak tab lajan dwe gen RLS AKTIVE.
check_c AS (
  SELECT
    'C. RLS aktive sou chak tab lajan' AS verifikasyon,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS rezilta,
    COALESCE(string_agg(m.t, ', '), 'okenn') AS detay
  FROM money_tables m
  JOIN pg_class c ON c.relname = m.t
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relrowsecurity = false
),

-- D) Okenn règleman EKRITI dirèk pou `authenticated` sou yon tab lajan.
--    (Tout ekriti dwe pase pa yon RPC SECURITY DEFINER.)
check_d AS (
  SELECT
    'D. Okenn ekriti dirèk authenticated sou tab lajan' AS verifikasyon,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS rezilta,
    COALESCE(string_agg(pol.tablename || '.' || pol.policyname || ' (' || pol.cmd || ')', ', '), 'okenn') AS detay
  FROM pg_policies pol
  JOIN money_tables m ON m.t = pol.tablename
  WHERE pol.schemaname = 'public'
    AND pol.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND 'authenticated' = ANY (pol.roles)
),

-- E) Balans yo dwe egal sòm ledger la (envaryan kontabilite fondamantal).
check_e AS (
  SELECT
    'E. sum(wallet_transactions) = balans wallet yo' AS verifikasyon,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS rezilta,
    COALESCE(string_agg(x.id::text || ' (ekri: ' || x.available_balance || ', ledger: ' || x.ledger_sum || ')', ', '), 'okenn') AS detay
  FROM (
    SELECT w.id, w.available_balance,
           COALESCE(sum(wt.available_delta), 0) AS ledger_sum
    FROM public.wallets w
    LEFT JOIN public.wallet_transactions wt ON wt.wallet_id = w.id
    GROUP BY w.id, w.available_balance
    HAVING w.available_balance <> COALESCE(sum(wt.available_delta), 0)
  ) x
)

SELECT * FROM check_a
UNION ALL SELECT * FROM check_b
UNION ALL SELECT * FROM check_c
UNION ALL SELECT * FROM check_d
UNION ALL SELECT * FROM check_e;
