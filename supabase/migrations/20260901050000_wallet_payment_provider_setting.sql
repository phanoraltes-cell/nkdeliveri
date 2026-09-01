-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 1C.
--
-- Ajoute yon ranje 'wallet' nan payment_provider_settings ki egziste deja
-- a, pou wallet swiv EGZAKTEMAN menm mekanis vizibilite/aktivasyon ak
-- lòt metòd yo (kach/moncash/natcash/stripe/moncash_auto/natcash_auto) —
-- checkout.tsx, dashboard.admin.payment-providers.tsx, ak
-- update_payment_provider_setting_secure aksepte deja NENPÒT valè
-- `provider` ki egziste kòm yon ranje (pa gen lis fiks kode an dou nan
-- fonksyon an) — okenn chanjman kòd SQL siplemantè nesesè pou sa.
INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider)
VALUES ('wallet', true, true, false)
ON CONFLICT (provider) DO NOTHING;
