/**
 * Long-horizon reconciliation for MonCash payouts stuck in `pending` —
 * distinct from moncash-client.server.ts's own immediate retry (3
 * attempts, 300ms/900ms backoff, inside a single HTTP request/response
 * cycle). This is the *other* retry layer: "the webhook never arrived,
 * or arrived and got lost" — run periodically (Vercel Cron, see
 * src/routes/api.cron.moncash-reconcile.ts), checking MonCash directly
 * via checkStatus() instead of waiting for a push that may never come.
 *
 * Backoff schedule matches the brief exactly: 30s → 2min → 10min → flag
 * for manual review. Never auto-fails a payout after exhausting the
 * schedule — "we don't know" is reported honestly, not guessed as a
 * failure that would release funds a real transfer might still complete.
 *
 * Inert today by construction, same as the rest of this integration:
 * create_pending_payout_secure has no live caller (MonCash disbursement
 * isn't supported — see docs/PAYMENT_PROVIDERS.md), so no
 * provider_code='moncash_api' payout can ever be 'pending' in
 * production yet. This module is real, tested code that activates the
 * moment that changes, not a placeholder.
 */
import { moncashProvider } from "./moncash-provider.server";

/** Wait at least this long after creation before the first check — gives a real webhook a chance to arrive first. */
const RECONCILE_AFTER_MS = 5 * 60_000;
/** Minimum gap required before each successive check: 30s, then 2min, then 10min. */
const BACKOFF_SCHEDULE_MS = [30_000, 120_000, 600_000];

export type ReconcileOutcome =
  "confirmed" | "failed" | "still_pending" | "not_yet_due" | "needs_manual_review";

export type ReconcileResult = {
  transactionReference: string;
  outcome: ReconcileOutcome;
};

export type ReconcileSummary = {
  candidates: number;
  results: ReconcileResult[];
};

type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

async function attemptsAndLastCheck(
  supabaseAdmin: SupabaseAdmin,
  transactionReference: string,
): Promise<{ attempts: number; lastCheckedAt: string | null }> {
  const { count } = await supabaseAdmin
    .from("moncash_api_logs")
    .select("id", { count: "exact", head: true })
    .eq("transaction_reference", transactionReference)
    .eq("endpoint", "/v1/RetrieveOrderPayment");

  const { data: last } = await supabaseAdmin
    .from("moncash_api_logs")
    .select("created_at")
    .eq("transaction_reference", transactionReference)
    .eq("endpoint", "/v1/RetrieveOrderPayment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { attempts: count ?? 0, lastCheckedAt: last?.created_at ?? null };
}

function isDue(attempts: number, lastCheckedAt: string | null): boolean {
  if (attempts === 0) return true; // first check is gated only by RECONCILE_AFTER_MS via the caller's own query
  if (attempts > BACKOFF_SCHEDULE_MS.length) return false; // exhausted — needs_manual_review, not another check
  if (!lastCheckedAt) return true;
  const requiredGapMs = BACKOFF_SCHEDULE_MS[Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)];
  return Date.now() - new Date(lastCheckedAt).getTime() >= requiredGapMs;
}

/**
 * Finds every `pending` MonCash Automatik payout old enough to check,
 * asks MonCash directly for its real status, and finalizes it via the
 * same RPCs the webhook path uses (complete/fail_pending_payout_secure)
 * — this function never touches a wallet balance itself, only ever
 * through those already-tested, already-idempotent RPCs.
 */
export async function reconcilePendingMonCashPayouts(): Promise<ReconcileSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("payouts")
    .select("transaction_reference")
    .eq("provider_code", "moncash_api")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - RECONCILE_AFTER_MS).toISOString());
  if (error) throw new Error(error.message);

  const results: ReconcileResult[] = [];

  for (const row of pending ?? []) {
    const reference = row.transaction_reference;
    const { attempts, lastCheckedAt } = await attemptsAndLastCheck(supabaseAdmin, reference);

    if (attempts > BACKOFF_SCHEDULE_MS.length) {
      results.push({ transactionReference: reference, outcome: "needs_manual_review" });
      continue;
    }
    if (!isDue(attempts, lastCheckedAt)) {
      results.push({ transactionReference: reference, outcome: "not_yet_due" });
      continue;
    }

    // checkStatus() itself calls retrieveOrderPayment(), which journals
    // this exact attempt (endpoint, timing, error) to moncash_api_logs —
    // that journal entry is what attemptsAndLastCheck() reads on the
    // next tick, so the schedule advances itself with no extra state.
    const status = await moncashProvider.checkStatus(reference);

    if (status.status === "success") {
      const { error: rpcError } = await supabaseAdmin.rpc("complete_pending_payout_secure", {
        _transaction_reference: reference,
        _provider_code: "moncash_api",
        _provider_transaction_id: status.providerReference,
      });
      if (rpcError) throw new Error(rpcError.message);
      results.push({ transactionReference: reference, outcome: "confirmed" });
    } else if (status.status === "failed") {
      const { error: rpcError } = await supabaseAdmin.rpc("fail_pending_payout_secure", {
        _transaction_reference: reference,
        _provider_code: "moncash_api",
        _reason: `Rekonsilyasyon otomatik: ${status.error}`,
      });
      if (rpcError) throw new Error(rpcError.message);
      results.push({ transactionReference: reference, outcome: "failed" });
    } else {
      results.push({ transactionReference: reference, outcome: "still_pending" });
    }
  }

  return { candidates: pending?.length ?? 0, results };
}
