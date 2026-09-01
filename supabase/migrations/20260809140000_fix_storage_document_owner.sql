-- Remediation of docs/archive/audits/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md § 5/14 (Root
-- Cause R4): register-documents.functions.ts's stampOwner() calls
-- `supabaseAdmin.schema("storage").from("objects").update(...)` after every
-- service-role upload -- confirmed live to have zero effect (both real
-- objects in restaurant-assets, from the one successful production
-- signup, have owner=NULL and owner_id=NULL despite this call running
-- right after each upload). The exact PostgREST-level cause (most likely:
-- "storage" is not in this project's exposed-schemas list, which
-- `.schema()` depends on regardless of using the service-role key) could
-- not be confirmed from this session -- no access to the project's Data
-- API settings, and no live log capture of the failing call.
--
-- Rather than guess further, this migration sidesteps the exact cause
-- entirely: a SECURITY DEFINER Postgres function reaches storage.objects
-- directly in SQL, which works regardless of what PostgREST exposes over
-- REST -- RPC calls only ever need the *function's own* schema (public)
-- to be exposed, never the schemas the function body touches internally.
-- Same principle already used throughout this project for every other
-- `*_secure` function writing to a table its caller has no direct grant on.
--
-- Explicitly scoped to ONLY the owner/owner_id columns, per this mission's
-- own rule ("corriger uniquement l'attribution du propriétaire") -- no RLS
-- change, no bucket visibility change, nothing here can expose a document
-- that wasn't already reachable through the existing (correct, audited)
-- storage.objects policies.
CREATE OR REPLACE FUNCTION public.stamp_storage_object_owner_secure(
  _bucket text, _path text, _owner uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE storage.objects
  SET owner = _owner, owner_id = _owner::text
  WHERE bucket_id = _bucket AND name = _path;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_storage_object_owner_secure(text, text, uuid) FROM PUBLIC;
-- service_role only -- this is exclusively called from
-- register-documents.functions.ts, which already runs with the service
-- role for the whole finalizeRegistrationDocuments handler. Same
-- least-privilege convention as flag_stale_collect_payment_secure
-- (20260808200000_flag_stale_collect_payments.sql).
GRANT EXECUTE ON FUNCTION public.stamp_storage_object_owner_secure(text, text, uuid) TO service_role;
