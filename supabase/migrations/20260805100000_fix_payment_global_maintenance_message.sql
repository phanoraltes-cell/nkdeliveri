-- Post-incident audit remediation, Correction 1 (docs/PAYMENT_POST_INCIDENT_AUDIT.md
-- "Bug confirmé n°1" / docs/PAYMENT_POST_INCIDENT_REMEDIATION_REPORT.md).
--
-- Pure data fix — no schema, no function, no permission touched. The
-- "Peman Otomatik" -> "Payment Global" rebrand (commit b11a433 onward)
-- updated every code-level label and the local checkout.tsx fallback
-- constant, but never the actual `maintenance_message` value already
-- sitting in the live `payment_provider_settings` row for `moncash_auto`
-- — that value was set by hand via the admin panel before the rebrand and
-- was simply never touched again. Currently dormant (moncash_auto.enabled
-- = true, so this text isn't shown to anyone today) but would display the
-- pre-rebrand name the next time an admin disables it for maintenance.
--
-- Guarded by the exact known-stale value so this is a no-op (0 rows
-- affected, not an error) if an admin has since edited the message by
-- hand via the admin panel to something else — this migration must never
-- clobber a real, intentional message with this fixed replacement text.
UPDATE public.payment_provider_settings
SET maintenance_message = 'Payment Global ap retounen byento.'
WHERE provider = 'moncash_auto'
  AND maintenance_message = 'MonCash Automatik ap retounen byento.';
