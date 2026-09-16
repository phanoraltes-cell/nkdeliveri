-- ===========================================================================
-- ODIT — RECHAJ PÒTFÈY KI KA BLOKE NAN CHEMEN REKIPERASYON AN
--
-- SA L CHÈCHE : konbyen `payment_intents` PLOP ki nan eta `expired` epi ki
-- ta tonbe nan chemen rekiperasyon otomatik la — chemen an ki KASE.
--
-- POUKISA : plop-wallet-topup-reconcile.server.ts:69 rele
-- `admin_recover_wallet_topup_secure` ak kle service role. Fonksyon an gade
-- `private.has_role(auth.uid(), 'admin')`, epi `auth.uid()` se NULL sou
-- service role — donk li leve 42501 chak fwa. Rezilta a: PLOP konfime yon
-- peman, men pòtfèy kliyan an pa janm kredite.
--
-- (Wè scripts/check-service-role-rpc.mjs, KNOWN_PENDING. Erè a byen
-- jounalize — "RPC FAILED AFTER PLOP CONFIRMED" — men yon jounal pa yon
-- kredi.)
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- ---------------------------------------------------------------------------
-- SA REKÈT SA A PA KA DI W
--
-- Li PA ka konnen kilès nan entansyon `expired` sa yo PLOP konfime kòm peye
-- — sa mande yon apèl sou API PLOP la pou chak referans. Sa rekèt la bay se
-- POPILASYON AN RIZIK la: ranje ki ta pase nan chemen kase a si
-- rekonsilyatè a kouri sou yo.
--
-- KIJAN POU LI REZILTA A : chèche `"nan_fenet_rekiperasyon"`.
--   0   -> pwoblèm nan latan; repare l anvan yon kliyan frape l
--   > 0 -> gen ranje ki ka gen lajan reyèl dèyè yo — tcheke yo nan PLOP
-- ===========================================================================

WITH parametr AS (
  -- MENM valè ak plop-wallet-topup-reconcile.server.ts. Si yo chanje la,
  -- chanje yo isit la tou — si non rekèt sa a ap manti.
  SELECT
    interval '10 minutes' AS min_age,   -- MIN_AGE_MS = 10 * 60_000
    interval '7 days'     AS recheck_window  -- RECHECK_WINDOW_MS
),
kandida AS (
  SELECT
    pi.external_reference,
    pi.status,
    pi.amount,
    pi.created_at,
    pi.user_id,
    now() - pi.created_at AS laj
  FROM public.payment_intents pi, parametr p
  WHERE pi.provider = 'plop_api'
    AND pi.status IN ('pending', 'expired')
    AND pi.created_at < now() - p.min_age
    AND pi.created_at > now() - p.recheck_window
),
-- Ranje `expired` yo se sèl yo ki ale nan chemen KASE a. `pending` yo pase
-- pa complete_wallet_topup_secure, ki pa mande auth.uid() — li mache.
ekspire AS (
  SELECT * FROM kandida WHERE status = 'expired'
),
-- Eske youn nan yo deja gen yon kredi nan ledger la? Si wi, li te rekipere
-- yon lòt jan epi li pa pèdi.
deja_kredite AS (
  SELECT count(*) AS n
  FROM ekspire e
  JOIN public.payment_intents pi ON pi.external_reference = e.external_reference
  JOIN public.wallet_transactions wt ON wt.idempotency_key = 'topup:' || pi.id
),
-- Popilasyon istorik la, pi laj pase fenèt la: konbyen rechaj PLOP ki
-- ekspire depi tout tan. Sa bay yon lide sou frekans lan.
istorik AS (
  SELECT
    count(*) FILTER (WHERE status = 'expired') AS ekspire_tout_tan,
    count(*) AS total_tout_tan,
    min(created_at) AS premye,
    max(created_at) AS dènye
  FROM public.payment_intents
  WHERE provider = 'plop_api'
)
SELECT jsonb_pretty(jsonb_build_object(
  'nan_fenet_rekiperasyon', (SELECT count(*) FROM ekspire),
  'ladan_yo_deja_kredite', (SELECT n FROM deja_kredite),
  'montan_total_htg', (SELECT coalesce(sum(amount), 0) FROM ekspire),
  'pi_ansyen_laj', (SELECT max(laj)::text FROM ekspire),
  'detay', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'referans', external_reference,
      'montan_htg', amount,
      'kreye', created_at,
      'laj', laj::text
    ) ORDER BY created_at), '[]'::jsonb)
    FROM ekspire
  ),
  'istorik_plop', (SELECT to_jsonb(i) FROM istorik i)
)) AS rezilta;
