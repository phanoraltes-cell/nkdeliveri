-- ===========================================================================
-- GAD MONTAN LAJAN NAN BAZ DONE A
-- ===========================================================================
-- Kontèks: bug `useDeliveryFee` la (`Number(undefined)` → `NaN` → « Total:
-- NaN HTG » ak bouton konfime a aktif) se yon fanmi defo, pa yon ka izole.
-- Kouch TypeScript la kounye a gen yon gad santral (src/lib/money.ts).
-- Fichye sa a se dènye kouch la: baz done a li menm dwe refize yon montan
-- ki pa yon montan, kèlkeswa ki kòd ki eseye ekri l.
--
-- POUKISA SA NESESÈ NAN POSTGRES: kontrèman ak sa anpil moun panse, tip
-- `numeric` PostgreSQL AKSEPTE valè espesyal `'NaN'`. `INSERT ... VALUES
-- ('NaN'::numeric)` mache san okenn erè. Donk yon RPC ki resevwa `null`
-- nan JSON (se sa `JSON.stringify(NaN)` bay!) oswa yon kalkil ki pase pa
-- NaN ka anrejistre yon montan ki pa yon nonb — epi apre sa CHAK sòm ki
-- touche ranje sa a vin NaN tou.
--
-- SEMANTIK NaN NAN `numeric` (diferan de IEEE 754): nan PostgreSQL,
-- `'NaN'::numeric = 'NaN'::numeric` se TRUE, epi NaN pi gwo pase tout lòt
-- valè. Se poutèt sa `col <> 'NaN'::numeric` se yon tès ki mache — yon tès
-- `col = col` (astis IEEE la) PA t ap mache isit la.
--
-- ---------------------------------------------------------------------------
-- `NOT VALID` SOU CHAK KONTRENT — EKSPRÈ.
--
-- `NOT VALID` vle di: kontrent la aplike sou CHAK nouvo ekriti ak chak
-- mizajou, men Postgres pa eskane ranje ki deja la. De rezon:
--
--   1. Migrasyon an pa ka echwe sou done pwodiksyon ki deja gen yon
--      pwoblèm. Yon migrasyon ki echwe kite baz la san okenn pwoteksyon —
--      pi mal pase yon pwoteksyon ki kouvri lavni sèlman.
--   2. Ranje ki deja kase yo se yon IJANS SEPARE, ki mande yon desizyon
--      moun (korije? anile? ranbouse?), pa yon `ALTER TABLE`.
--
-- Pou jwenn ranje sa yo: scripts/sql/find-invalid-amounts.sql. Lè yo
-- korije, ou ka valide chak kontrent ak:
--     ALTER TABLE public.<tab> VALIDATE CONSTRAINT <non>;
-- (Sa a pran yon vewou ki pi lejè pase yon eskan konplè epi li ka kouri
-- pandan sit la ap travay.)
--
-- IDANPOTAN: chak kontrent gen `DROP CONSTRAINT IF EXISTS` anvan — pa gen
-- `ADD CONSTRAINT IF NOT EXISTS` nan PostgreSQL.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Yon fonksyon sèl pou tès la, pou entansyon an li nan chak kontrent.
--
-- IMMUTABLE: li depann sèlman de agiman l, donk Postgres ka sèvi avè l nan
-- yon CHECK. `NULL` pase — yon kolòn ki ka NULL gen pwòp semantik pa l
-- (« pa gen frè »), sa diferan de « frè a se yon bagay ki pa yon nonb ».
CREATE OR REPLACE FUNCTION public.is_valid_amount(_value numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT _value IS NULL OR _value <> 'NaN'::numeric;
$$;

COMMENT ON FUNCTION public.is_valid_amount(numeric) IS
  'Vre si valè a se yon montan ki ka esplike: NULL (absan) oswa yon nonb ki pa NaN. Tip numeric PostgreSQL aksepte ''NaN'' — se sa fonksyon sa a bloke.';

REVOKE ALL ON FUNCTION public.is_valid_amount(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_amount(numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Kontrent « pa NaN » sou chak kolòn lajan.
--
-- Nou pa mete kontrent « pa negatif » isit la sou tout bagay: yon
-- `wallet_transactions.available_delta` DWE ka negatif (se konsa yon debi
-- ekri), epi `wallets.available_balance` ka tonbe negatif nan yon ka
-- rekonsilyasyon ki dwe rete vizib olye li bloke. Nou mete « pa negatif »
-- SÈLMAN kote yon montan negatif pa gen okenn sans posib (§3).

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_amounts_are_numbers;
ALTER TABLE public.orders ADD CONSTRAINT orders_amounts_are_numbers CHECK (
  public.is_valid_amount(subtotal)
  AND public.is_valid_amount(total)
  AND public.is_valid_amount(delivery_fee)
  AND public.is_valid_amount(service_fee)
  AND public.is_valid_amount(discount_amount)
  AND public.is_valid_amount(promotion_discount_amount)
) NOT VALID;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_amounts_are_numbers;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_amounts_are_numbers CHECK (
  public.is_valid_amount(unit_price) AND public.is_valid_amount(line_total)
) NOT VALID;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_is_number;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_is_number CHECK (
  public.is_valid_amount(amount)
) NOT VALID;

ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_amounts_are_numbers;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_amounts_are_numbers CHECK (
  public.is_valid_amount(amount)
  AND public.is_valid_amount(fee_amount)
  AND public.is_valid_amount(net_amount)
) NOT VALID;

ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_balances_are_numbers;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_balances_are_numbers CHECK (
  public.is_valid_amount(available_balance)
  AND public.is_valid_amount(pending_balance)
  AND public.is_valid_amount(paid_balance)
  AND public.is_valid_amount(lifetime_earnings)
) NOT VALID;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_deltas_are_numbers;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_deltas_are_numbers CHECK (
  public.is_valid_amount(available_delta)
  AND public.is_valid_amount(pending_delta)
  AND public.is_valid_amount(paid_delta)
  AND public.is_valid_amount(lifetime_delta)
) NOT VALID;

ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_amount_is_number;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_amount_is_number CHECK (
  public.is_valid_amount(amount)
) NOT VALID;

ALTER TABLE public.commission_ledger DROP CONSTRAINT IF EXISTS commission_ledger_amounts_are_numbers;
ALTER TABLE public.commission_ledger ADD CONSTRAINT commission_ledger_amounts_are_numbers CHECK (
  public.is_valid_amount(gross_amount)
  AND public.is_valid_amount(net_amount)
  AND public.is_valid_amount(commission_amount)
  AND public.is_valid_amount(commission_rate)
) NOT VALID;

ALTER TABLE public.payout_commissions DROP CONSTRAINT IF EXISTS payout_commissions_amount_is_number;
ALTER TABLE public.payout_commissions ADD CONSTRAINT payout_commissions_amount_is_number CHECK (
  public.is_valid_amount(covered_amount)
) NOT VALID;

ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_amount_is_number;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_amount_is_number CHECK (
  public.is_valid_amount(amount)
) NOT VALID;

ALTER TABLE public.payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_amount_is_number;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_amount_is_number CHECK (
  public.is_valid_amount(amount)
) NOT VALID;

ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_fee_is_number;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_fee_is_number CHECK (
  public.is_valid_amount(fee)
) NOT VALID;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_is_number;
ALTER TABLE public.products ADD CONSTRAINT products_price_is_number CHECK (
  public.is_valid_amount(price)
) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3) Konfigirasyon: yon montan envalid isit la kontamine CHAK kòmand oswa
--    CHAK retrè apre l, pa yon sèl ranje. Se poutèt sa nou mande « pa NaN
--    EPI pa negatif » sou yo — yon frè livrezon negatif oswa yon règ frè
--    negatif pa gen okenn sans, li ta kreye lajan.

ALTER TABLE public.platform_delivery_zones DROP CONSTRAINT IF EXISTS platform_delivery_zones_fee_is_sane;
ALTER TABLE public.platform_delivery_zones ADD CONSTRAINT platform_delivery_zones_fee_is_sane CHECK (
  public.is_valid_amount(fee_htg) AND fee_htg >= 0
) NOT VALID;

ALTER TABLE public.withdrawal_rules DROP CONSTRAINT IF EXISTS withdrawal_rules_amounts_are_sane;
ALTER TABLE public.withdrawal_rules ADD CONSTRAINT withdrawal_rules_amounts_are_sane CHECK (
  public.is_valid_amount(fee_percentage) AND fee_percentage >= 0 AND fee_percentage <= 100
  AND public.is_valid_amount(flat_fee) AND flat_fee >= 0
  AND public.is_valid_amount(min_amount) AND min_amount >= 0
  AND public.is_valid_amount(max_amount) AND (max_amount IS NULL OR max_amount >= 0)
  AND public.is_valid_amount(free_threshold) AND (free_threshold IS NULL OR free_threshold >= 0)
  AND public.is_valid_amount(daily_limit) AND (daily_limit IS NULL OR daily_limit >= 0)
  AND public.is_valid_amount(weekly_limit) AND (weekly_limit IS NULL OR weekly_limit >= 0)
) NOT VALID;

COMMIT;
