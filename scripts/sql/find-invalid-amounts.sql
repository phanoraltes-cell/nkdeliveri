-- ===========================================================================
-- DYAGNOSTIK: èske gen yon montan envalid ki DEJA anrejistre?
-- ===========================================================================
-- Kouri sa a nan SQL Editor Supabase la. Li LI SÈLMAN — li pa chanje anyen.
--
-- Poukisa li egziste: migrasyon 20260905000000 mete kontrent yo an
-- `NOT VALID`, sa vle di yo pwoteje lavni men yo pa eskane sa ki deja la.
-- Se nòmal: yon ranje ki deja kase mande yon desizyon moun (korije?
-- anile? ranbouse?), pa yon `ALTER TABLE` ki echwe nan mitan lannwit.
--
-- Sa li chèche:
--   A. `NaN` nan yon kolòn lajan (tip `numeric` PostgreSQL aksepte l).
--   B. Montan negatif kote sa pa gen sans.
--   C. Enkoyerans ant montan ki depann youn de lòt (net = brit - frè).
--   D. Ranje ki ta anpeche `VALIDATE CONSTRAINT` pase.
--
-- Si TOUT bò A/B/C retounen 0 ranje: ou ka valide kontrent yo (wè fen
-- fichye a) epi baz la pwoteje nèt, pa sèlman pou lavni.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A) NaN nan kolòn lajan yo.
--
-- `x = 'NaN'::numeric` se TRUE sèlman pou NaN nan semantik `numeric`
-- PostgreSQL (kote NaN egal tèt li epi li pi gwo pase tout lòt valè) —
-- diferan de IEEE 754, kote NaN pa egal anyen.
WITH nan_counts AS (
  SELECT 'orders.subtotal' AS kolòn, count(*) AS ranje FROM public.orders WHERE subtotal = 'NaN'::numeric
  UNION ALL SELECT 'orders.total', count(*) FROM public.orders WHERE total = 'NaN'::numeric
  UNION ALL SELECT 'orders.delivery_fee', count(*) FROM public.orders WHERE delivery_fee = 'NaN'::numeric
  UNION ALL SELECT 'orders.service_fee', count(*) FROM public.orders WHERE service_fee = 'NaN'::numeric
  UNION ALL SELECT 'orders.discount_amount', count(*) FROM public.orders WHERE discount_amount = 'NaN'::numeric
  UNION ALL SELECT 'orders.promotion_discount_amount', count(*) FROM public.orders WHERE promotion_discount_amount = 'NaN'::numeric
  UNION ALL SELECT 'order_items.unit_price', count(*) FROM public.order_items WHERE unit_price = 'NaN'::numeric
  UNION ALL SELECT 'order_items.line_total', count(*) FROM public.order_items WHERE line_total = 'NaN'::numeric
  UNION ALL SELECT 'payments.amount', count(*) FROM public.payments WHERE amount = 'NaN'::numeric
  UNION ALL SELECT 'payouts.amount', count(*) FROM public.payouts WHERE amount = 'NaN'::numeric
  UNION ALL SELECT 'payouts.fee_amount', count(*) FROM public.payouts WHERE fee_amount = 'NaN'::numeric
  UNION ALL SELECT 'payouts.net_amount', count(*) FROM public.payouts WHERE net_amount = 'NaN'::numeric
  UNION ALL SELECT 'wallets.available_balance', count(*) FROM public.wallets WHERE available_balance = 'NaN'::numeric
  UNION ALL SELECT 'wallets.pending_balance', count(*) FROM public.wallets WHERE pending_balance = 'NaN'::numeric
  UNION ALL SELECT 'wallets.paid_balance', count(*) FROM public.wallets WHERE paid_balance = 'NaN'::numeric
  UNION ALL SELECT 'wallets.lifetime_earnings', count(*) FROM public.wallets WHERE lifetime_earnings = 'NaN'::numeric
  UNION ALL SELECT 'wallet_transactions.available_delta', count(*) FROM public.wallet_transactions WHERE available_delta = 'NaN'::numeric
  UNION ALL SELECT 'wallet_transactions.pending_delta', count(*) FROM public.wallet_transactions WHERE pending_delta = 'NaN'::numeric
  UNION ALL SELECT 'wallet_transactions.paid_delta', count(*) FROM public.wallet_transactions WHERE paid_delta = 'NaN'::numeric
  UNION ALL SELECT 'wallet_transactions.lifetime_delta', count(*) FROM public.wallet_transactions WHERE lifetime_delta = 'NaN'::numeric
  UNION ALL SELECT 'refunds.amount', count(*) FROM public.refunds WHERE amount = 'NaN'::numeric
  UNION ALL SELECT 'commission_ledger.gross_amount', count(*) FROM public.commission_ledger WHERE gross_amount = 'NaN'::numeric
  UNION ALL SELECT 'commission_ledger.net_amount', count(*) FROM public.commission_ledger WHERE net_amount = 'NaN'::numeric
  UNION ALL SELECT 'commission_ledger.commission_amount', count(*) FROM public.commission_ledger WHERE commission_amount = 'NaN'::numeric
  UNION ALL SELECT 'payout_commissions.covered_amount', count(*) FROM public.payout_commissions WHERE covered_amount = 'NaN'::numeric
  UNION ALL SELECT 'payment_intents.amount', count(*) FROM public.payment_intents WHERE amount = 'NaN'::numeric
  UNION ALL SELECT 'payment_transactions.amount', count(*) FROM public.payment_transactions WHERE amount = 'NaN'::numeric
  UNION ALL SELECT 'deliveries.fee', count(*) FROM public.deliveries WHERE fee = 'NaN'::numeric
  UNION ALL SELECT 'products.price', count(*) FROM public.products WHERE price = 'NaN'::numeric
  UNION ALL SELECT 'platform_delivery_zones.fee_htg', count(*) FROM public.platform_delivery_zones WHERE fee_htg = 'NaN'::numeric
)
SELECT 'A. NaN' AS tès, kolòn, ranje,
       CASE WHEN ranje = 0 THEN 'OK' ELSE 'IJANS — montan ki pa yon nonb' END AS verdi
FROM nan_counts
WHERE ranje > 0
UNION ALL
SELECT 'A. NaN', '(tout kolòn yo)', 0, 'OK — okenn NaN nan baz la'
WHERE NOT EXISTS (SELECT 1 FROM nan_counts WHERE ranje > 0)
ORDER BY 3 DESC, 2;

-- ---------------------------------------------------------------------------
-- B) Montan negatif kote sa pa gen sans.
--
-- `wallet_transactions.*_delta` PA nan lis la: yon debi se yon delta
-- negatif, se konsa liv la travay. `wallets.available_balance` non plis —
-- yon balans negatif se yon pwoblèm rekonsilyasyon ki dwe rete VIZIB, pa
-- yon bagay pou bloke isit.
SELECT 'B. Negatif' AS tès, kolòn, ranje, 'Verifye chak ranje alamen' AS verdi
FROM (
  SELECT 'orders.total < 0' AS kolòn, count(*) AS ranje FROM public.orders WHERE total < 0
  UNION ALL SELECT 'orders.subtotal < 0', count(*) FROM public.orders WHERE subtotal < 0
  UNION ALL SELECT 'orders.delivery_fee < 0', count(*) FROM public.orders WHERE delivery_fee < 0
  UNION ALL SELECT 'payments.amount < 0', count(*) FROM public.payments WHERE amount < 0
  UNION ALL SELECT 'payouts.amount < 0', count(*) FROM public.payouts WHERE amount < 0
  UNION ALL SELECT 'payouts.fee_amount < 0', count(*) FROM public.payouts WHERE fee_amount < 0
  UNION ALL SELECT 'payouts.net_amount < 0', count(*) FROM public.payouts WHERE net_amount < 0
  UNION ALL SELECT 'refunds.amount < 0', count(*) FROM public.refunds WHERE amount < 0
  UNION ALL SELECT 'deliveries.fee < 0', count(*) FROM public.deliveries WHERE fee < 0
  UNION ALL SELECT 'products.price < 0', count(*) FROM public.products WHERE price < 0
  UNION ALL SELECT 'platform_delivery_zones.fee_htg < 0', count(*) FROM public.platform_delivery_zones WHERE fee_htg < 0
) t
WHERE ranje > 0;

-- ---------------------------------------------------------------------------
-- C) Enkoyerans ant montan ki depann youn de lòt.
--
-- C1 — `net_amount` yon retrè dwe egal `amount - fee_amount` (modèl frè
-- Tach 3D: montan brit mande, frè retire ladan l). Yon ekà isit la vle di
-- swa yon kalkil ki kase, swa yon ranje ki soti anvan Tach 3D ki poko
-- ranpli. Toude merite yon gade, paske se sou `net_amount` nou voye lajan
-- bay pwovidè a.
SELECT 'C1. net <> brit - frè' AS tès,
       id::text AS referans,
       amount, fee_amount, net_amount,
       (amount - COALESCE(fee_amount, 0)) AS net_atann,
       status
FROM public.payouts
WHERE net_amount IS NOT NULL
  AND fee_amount IS NOT NULL
  AND net_amount <> amount - fee_amount
ORDER BY created_at DESC
LIMIT 50;

-- C2 — `orders.total` dwe egal fòmil la sèvè a itilize nan
-- create_order_secure: soutotal − pwomosyon − rabè + livrezon + sèvis.
SELECT 'C2. total kòmand pa matche fòmil la' AS tès,
       order_number, subtotal, promotion_discount_amount, discount_amount,
       delivery_fee, service_fee, total,
       (subtotal - promotion_discount_amount - discount_amount + delivery_fee + service_fee) AS total_atann,
       created_at
FROM public.orders
WHERE total <> (subtotal - promotion_discount_amount - discount_amount + delivery_fee + service_fee)
ORDER BY created_at DESC
LIMIT 50;

-- C3 — Balans wallet dwe matche sòm liv la (menm envaryan ak
-- scripts/sql/verify-money-authorization.sql, repete isit pou dyagnostik
-- la konplè pou kont li).
SELECT 'C3. balans pa matche liv la' AS tès,
       w.id::text AS wallet_id,
       w.available_balance,
       COALESCE(sum(t.available_delta), 0) AS sòm_liv,
       w.available_balance - COALESCE(sum(t.available_delta), 0) AS ekà
FROM public.wallets w
LEFT JOIN public.wallet_transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.available_balance
HAVING w.available_balance <> COALESCE(sum(t.available_delta), 0)
ORDER BY abs(w.available_balance - COALESCE(sum(t.available_delta), 0)) DESC
LIMIT 50;

-- ---------------------------------------------------------------------------
-- D) Kontrent ki poko valide.
--
-- Chak ranje isit la se yon kontrent ki pwoteje nouvo ekriti yo men ki pa
-- ankò garanti sou done istorik yo.
SELECT 'D. Kontrent NOT VALID' AS tès,
       rel.relname AS tab,
       con.conname AS kontrent,
       'ALTER TABLE public.' || rel.relname || ' VALIDATE CONSTRAINT ' || con.conname || ';' AS kòmand_pou_valide
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND con.contype = 'c'
  AND NOT con.convalidated
ORDER BY rel.relname, con.conname;
