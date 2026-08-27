/**
 * Audit remediation (2026-08-27, FIN-001): wallets.available_balance is a
 * stored, incrementally-updated running total (see commission_engine.sql's
 * triggers), not derived fresh from commission_ledger on every read. Every
 * individual credit/debit pair was verified symmetric and idempotent
 * during the audit, but nothing previously existed to catch a FUTURE
 * regression that breaks that symmetry. This module is that safety net —
 * it detects and records a drift, it never corrects one automatically (see
 * the migration's own comment on why).
 *
 * Delegates the actual comparison to private.run_wallet_reconciliation_
 * secure() (supabase/migrations/20260827130000_audit_remediation_dead_
 * grant_and_reconciliation.sql) — SQL, not application code, so the exact
 * same numbers are visible via psql for manual investigation, not locked
 * inside a TypeScript-only computation.
 */
export type WalletReconciliationSummary = {
  checkedCount: number;
  discrepancyCount: number;
};

export async function runWalletReconciliation(): Promise<WalletReconciliationSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("run_wallet_reconciliation_secure");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    checkedCount: row?.checked_count ?? 0,
    discrepancyCount: row?.discrepancy_count ?? 0,
  };
}
