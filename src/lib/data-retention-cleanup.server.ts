/**
 * NKD-021 — daily retention cleanup (Faz 11, docs/archive/phases/PHASE11_COMPLIANCE_AUDIT.md;
 * docs/archive/phases/NKD-021_DATA_RETENTION_REPORT.md). Runs once a day (Vercel Cron —
 * src/routes/api.cron.data-retention.ts and vercel.json), same cadence as
 * moncash-reconcile.server.ts/plop-reconcile.server.ts and the same reason:
 * the Vercel Hobby plan's ceiling on Cron Job frequency.
 *
 * Deliberately narrow scope (owner-confirmed, KANPE EPI MANDE round):
 * purges only private.rate_limit_hits (7 days) and public.notifications
 * (90 days) — both operational/technical data with zero value once their
 * window passes. orders/payments/disputes/refunds/reviews/audit_log are
 * NEVER touched by this or any other automated job (same reasoning as
 * NKD-020's anonymization tool: financial/audit records are retained,
 * not auto-deleted).
 *
 * All the actual logic (thresholds, the two DELETE statements) lives in
 * the SQL RPC (run_data_retention_cleanup_secure, service_role-only) —
 * this module is a thin wrapper, same shape as
 * plop-reconcile.server.ts's own RPC-calling functions.
 */
type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

export type RetentionCleanupSummary = {
  category: string;
  rowsDeleted: number;
}[];

export async function runDataRetentionCleanup(
  supabaseAdmin: SupabaseAdmin,
): Promise<RetentionCleanupSummary> {
  const { data, error } = await supabaseAdmin.rpc("run_data_retention_cleanup_secure");
  if (error) throw error;
  return (data ?? []).map((row) => ({ category: row.category, rowsDeleted: row.rows_deleted }));
}
