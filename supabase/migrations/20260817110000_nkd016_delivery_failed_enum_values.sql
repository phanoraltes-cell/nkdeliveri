-- NKD-016 (part 1/2) — new enum values for the "failed delivery" business
-- rule. Split into its own migration on purpose: Postgres forbids using a
-- new enum value (in an INSERT/UPDATE/comparison) inside the same
-- transaction that added it via ALTER TYPE ... ADD VALUE. Part 2
-- (supabase/migrations/20260817120000_nkd016_delivery_failed.sql) uses
-- these three values, so this file must be committed first.
--
-- ROLLBACK: Postgres does not support DROP VALUE on an enum. If this must
-- ever be reverted: 1) confirm zero rows reference 'delivery_failed' /
-- 'driver_commission_delivery_failed' (SELECT count(*) FROM orders WHERE
-- status = 'delivery_failed', etc. — must all be 0), 2) recreate each
-- affected type without the new value under a temp name, 3) ALTER TABLE
-- ... ALTER COLUMN ... TYPE <temp> USING <col>::text::<temp> for every
-- column using it (public.orders.status, public.deliveries.status,
-- public.commission_ledger.entry_type), 4) DROP the old type, rename the
-- temp type into place. Not scripted here — this is a rare, manual,
-- data-verified operation, never run blind.

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'delivery_failed';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'delivery_failed';
ALTER TYPE public.commission_entry_type ADD VALUE IF NOT EXISTS 'driver_commission_delivery_failed';
