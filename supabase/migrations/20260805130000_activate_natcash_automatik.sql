-- Explicit activation of NatCash Otomatik (docs/PLOP_NATCASH_INTEGRATION_PLAN.md),
-- requested directly by the user ("Aktive Natcash otomatik", 2026-08-05),
-- same deliberate manual-activation convention `moncash_auto` itself
-- followed (never auto-enabled by its own creating migration).
--
-- Also fixes a live data inconsistency surfaced while verifying this
-- activation: `moncash_auto.maintenance_message` still read "Payment
-- Global ap retounen byento." — the label from the now-superseded
-- "Payment Global" unified-button era. Since checkout.tsx reverted to
-- separate "MonCash Otomatik"/"NatCash Otomatik" buttons
-- (docs/PLOP_NATCASH_INTEGRATION_PLAN.md), this stale value needed
-- correcting to match, exactly the same class of drift
-- 20260805100000_fix_payment_global_maintenance_message.sql fixed once
-- already for the previous rename.

UPDATE public.payment_provider_settings
SET maintenance_message = 'MonCash Otomatik ap retounen byento.'
WHERE provider = 'moncash_auto'
  AND maintenance_message = 'Payment Global ap retounen byento.';

UPDATE public.payment_provider_settings
SET enabled = true
WHERE provider = 'natcash_auto';
