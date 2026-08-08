-- Payment security remediation (docs/PAYMENT_SECURITY_REMEDIATION.md).
--
-- GRANT/REVOKE-only migration — no function body, signature, RLS policy,
-- or table structure changes. Every finding here was empirically verified
-- via BEGIN/ROLLBACK transactional tests against real production data
-- (anon direct table writes, cross-customer creation, non-admin RPC
-- calls, disabled-provider bypass, double-payment, webhook replay) —
-- every attack path was already correctly blocked by an internal
-- `auth.uid()`/ownership/admin-role check (functions) or by RLS's
-- default-deny-when-no-matching-policy behavior (tables). Nothing here
-- fixes an active vulnerability; it closes confirmed *excess grants* that
-- currently do nothing (no policy or internal check ever lets them
-- through) but are real defense-in-depth debt — least privilege, not
-- "it was broken". See the report for the full evidence trail.

-- ---------------------------------------------------------------------------
-- 1) Table grants — REVOKE only the privileges no RLS policy ever governs
-- for that role/command combination (verified by direct introspection of
-- pg_policies before writing this). SELECT/UPDATE grants that a real
-- policy actually restricts (e.g. `payments` SELECT for authenticated,
-- `payment_provider_settings` SELECT for anon+authenticated) are left
-- untouched — those are the intended "grant broad, restrict via RLS"
-- pattern this whole schema already uses, not a gap.

-- payments: anon has zero RLS-applicable policy for ANY command (every
-- existing policy is `TO authenticated` only) — its SELECT/INSERT/UPDATE/
-- DELETE grants are entirely dead weight. Confirmed via a real anon
-- INSERT attempt in the same transaction as this audit: rejected by RLS
-- regardless ("new row violates row-level security policy"); revoking
-- the grant removes the reliance on RLS being the only backstop.
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.payments FROM anon;

-- payment_transactions: authenticated has INSERT/UPDATE/DELETE grants but
-- zero RLS policy for any of those three commands (only the 2 SELECT
-- policies exist) — create_collect_payment_secure/
-- complete_collect_payment_secure (SECURITY DEFINER, bypass RLS as the
-- table owner) are the only real paths. Confirmed via a real
-- authenticated UPDATE/INSERT attempt: 0 rows affected / rejected.
REVOKE INSERT, UPDATE, DELETE ON public.payment_transactions FROM authenticated;

-- payment_provider_settings: same pattern — only the public-read SELECT
-- policy exists; update_payment_provider_setting_secure is the only real
-- write path.
REVOKE INSERT, UPDATE, DELETE ON public.payment_provider_settings FROM authenticated;

-- payment_proofs: anon has zero applicable policy (the one SELECT policy
-- is `TO authenticated` only) — all 4 grants are dead weight. authenticated's
-- own INSERT/UPDATE/DELETE grants are equally ungoverned — the real write
-- path is submit_payment_proof_secure (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.payment_proofs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_proofs FROM authenticated;

-- refunds: only 1 SELECT policy exists; request_refund_secure/
-- review_refund_secure/complete_refund_secure (all SECURITY DEFINER) are
-- the only real write paths.
REVOKE INSERT, UPDATE, DELETE ON public.refunds FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2) Function grants — REVOKE EXECUTE from `anon` on every payment/payout
-- SECURITY DEFINER function that structurally requires a real session
-- (every one below either starts with `IF v_user IS NULL`/an ownership
-- join, or an explicit admin-role check — verified by reading every body
-- and, for the admin-only ones, by a real BEGIN/ROLLBACK test simulating
-- both an anonymous caller and a genuine non-admin customer, both
-- correctly rejected). `authenticated`/`service_role` grants are
-- untouched — every one of these is legitimately callable by *some*
-- authenticated user (a customer managing their own refund/proof, a
-- restaurant/driver managing their own payout, or an admin).
--
-- Deliberately NOT touched: get_platform_payout_public() — anon access is
-- correct by design (the platform's own MonCash/NatCash receiving
-- numbers are meant to be shown to any visitor, same as a business
-- publishing its own payment info).
REVOKE EXECUTE ON FUNCTION public.complete_refund_secure(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_cash_payment_secure(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_payout_secure(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispute_cash_payment_secure(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispute_payout_secure(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_payout_kpis() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_payouts_monthly_series(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.initiate_payout_secure(uuid, uuid, numeric, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_refund_secure(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_payout_dispute_secure(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.review_manual_payment_secure(uuid, payment_status, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.review_refund_secure(uuid, refund_status, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_payment_proof_secure(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_driver_payout_secure(uuid, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_platform_payout_settings_secure(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_restaurant_payout_secure(uuid, text, text, text, text) FROM anon;
