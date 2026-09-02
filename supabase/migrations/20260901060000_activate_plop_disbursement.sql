-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 3, ETAP FINAL
-- AKTIVASYON. ⚠️ PA APLIKE FICHYE SA A ANVAN OU FÈ YON VRÈ TÈS PETI MONTAN.
--
-- Tout entegrasyon API Retrè PLOP la (plop-client.server.ts,
-- plop-provider.server.ts, index.server.ts) EGZISTE e PARE — men
-- `payment_providers.is_active` rete `false` pou 'moncash_api'/
-- 'natcash_api' jiskaske migrasyon SA A aplike (menm "yon sèl liy pou
-- aktive" ki te prevwa depi kòmansman, 20260722190000_payment_provider_
-- prep.sql). San l, PayoutPayModal kontinye montre "MonCash Automatik"/
-- "NatCash Automatik" kòm dezaktive — okenn dekèsman otomatik pa ka rive
-- pandan migrasyon sa a poko aplike.
--
-- POUKISA SEPARE: pa gen okenn anviwònman tès (sandbox) PLOP pou Retrè
-- (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 14.3) — premye vrè apèl API a ap deplase
-- VRÈ lajan. Rekòmandasyon: fè YON retrè manyèl tès ak yon PI PITI montan
-- posib (verifye ak vrè founisè MonCash/NatCash a apre) AVAN aplike
-- migrasyon sa a pou tout ekip la, pou konfime siyati HMAC/repons API a
-- mache egzakteman jan dokimantasyon an dekri.
UPDATE public.payment_providers
   SET is_active = true
 WHERE code IN ('moncash_api', 'natcash_api');
