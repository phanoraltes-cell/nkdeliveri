-- PLOP payment provider — API call audit log (Phase 2 of the PLOP Collect
-- replacement, see docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 10 and
-- docs/archive/plop/PLOP_REMEDIATION_REPORT.md § "Objectif 5"). A NEW table, not a
-- reuse of moncash_api_logs — PLOP is a distinct fournisseur with its own
-- contract (docs/archive/plop/PLOP_PHASE0_AUDIT.md) — but its schema is matrix-matched
-- field-for-field to moncash_api_logs
-- (supabase/migrations/20260730130000_moncash_financial_audit_log.sql) so
-- Dashboard/Monitoring/KPI/Alertes queries written against one work
-- unmodified against the other, just by swapping the table name.
--
-- Written and versioned here per this project's convention (never
-- `supabase db push` — applied by hand after review). Purely additive:
-- touches no existing table, RPC, or policy.

CREATE TABLE public.plop_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  attempt int NOT NULL DEFAULT 1,
  http_status int,
  duration_ms int NOT NULL,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb,
  error text,
  is_timeout boolean NOT NULL DEFAULT false,
  transaction_reference text,
  provider_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plop_api_logs_created_at_idx ON public.plop_api_logs(created_at DESC);
CREATE INDEX plop_api_logs_transaction_reference_idx ON public.plop_api_logs(transaction_reference);
CREATE INDEX plop_api_logs_endpoint_idx ON public.plop_api_logs(endpoint);

ALTER TABLE public.plop_api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plop_api_logs admin read" ON public.plop_api_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.plop_api_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plop_api_logs TO authenticated;
GRANT SELECT, INSERT ON public.plop_api_logs TO service_role;
-- No UPDATE/DELETE grant to service_role either -- the triggers below
-- would reject it anyway, but there is no reason to even offer the
-- privilege for a table that must never be mutated after insert (same
-- reasoning as moncash_api_logs).

-- Append-only enforcement, at the database level, for every role
-- including service_role. Reuses the trigger function already created by
-- 20260730130000_moncash_financial_audit_log.sql
-- (private.prevent_log_mutation()) -- never a second copy of the same
-- guard logic for a second audit table.
CREATE TRIGGER plop_api_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON public.plop_api_logs
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();

CREATE TRIGGER plop_api_logs_no_truncate
  BEFORE TRUNCATE ON public.plop_api_logs
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();
