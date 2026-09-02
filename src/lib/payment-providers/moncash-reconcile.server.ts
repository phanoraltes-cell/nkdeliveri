/**
 * Long-horizon reconciliation for `provider_code='moncash_api'`/
 * `'natcash_api'` payouts stuck in `pending` — distinct from a provider's
 * own immediate retry inside a single request/response cycle. This is
 * the *other* retry layer: "no immediate answer, check back later" — run
 * periodically (Vercel Cron, see src/routes/api.cron.moncash-reconcile.ts),
 * checking the provider directly via checkStatus() instead of waiting
 * for a push that may never come.
 *
 * Backoff schedule: 30s → 2min → 10min → flag for manual review. Never
 * auto-fails a payout after exhausting the schedule — "we don't know" is
 * reported honestly, not guessed as a failure that would release funds a
 * real transfer might still complete.
 *
 * PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE), Tach 3 — this module
 * was written against the dormant MonCash Digicel disbursement
 * integration (never activated — see docs/reference/PAYMENT_PROVIDERS.md)
 * and is now repointed at PLOP's real Withdrawal API instead
 * (plop-provider.server.ts), the registry's `getPaymentProvider("moncash_api"|
 * "natcash_api")` now resolving to plopProvider for both codes (Tach 3,
 * index.server.ts) — same "swap the implementation behind the same
 * provider_code" pattern already used for Collect. `attemptsAndLastCheck`
 * below is updated to read `plop_api_logs` (PLOP's own audit log,
 * matrix-matched to moncash_api_logs field-for-field) at PLOP's verify
 * endpoint, instead of the Digicel-specific `moncash_api_logs`/
 * `/v1/RetrieveOrderPayment` this file previously read — PLOP's own
 * disbursement executes *synchronously* in the normal case (§ 8 of the
 * PLOP audit), so a `pending` payout row is the rare async edge case this
 * schedule exists specifically to eventually resolve, not the common
 * path.
 */
import { plopProvider } from "./plop-provider.server";

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
  // Tach 3 — plop_api_logs (PLOP's own audit trail), not moncash_api_logs:
  // plopProvider.checkStatus() for a withdrawal reference calls
  // verifyWithdrawal(), which journals to plop_api_logs at this exact
  // endpoint (plop-client.server.ts's own writeApiLog call).
  const { count } = await supabaseAdmin
    .from("plop_api_logs")
    .select("id", { count: "exact", head: true })
    .eq("transaction_reference", transactionReference)
    .eq("endpoint", "/api/withdraw/marchand/verify");

  const { data: last } = await supabaseAdmin
    .from("plop_api_logs")
    .select("created_at")
    .eq("transaction_reference", transactionReference)
    .eq("endpoint", "/api/withdraw/marchand/verify")
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
 * Finds every `pending` PLOP-backed payout (provider_code 'moncash_api'
 * OR 'natcash_api' — both resolve to plopProvider now, Tach 3) old
 * enough to check, asks PLOP directly for its real status via
 * verifyWithdrawal(), and finalizes it via the same RPCs the immediate-
 * success path uses (complete/fail_pending_payout_secure) — this
 * function never touches a wallet balance itself, only ever through
 * those already-tested, already-idempotent RPCs.
 */
export async function reconcilePendingMonCashPayouts(): Promise<ReconcileSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("payouts")
    .select("transaction_reference, provider_code")
    .in("provider_code", ["moncash_api", "natcash_api"])
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

    // checkStatus() itself calls verifyWithdrawal(), which journals this
    // exact attempt (endpoint, timing, error) to plop_api_logs — that
    // journal entry is what attemptsAndLastCheck() reads on the next
    // tick, so the schedule advances itself with no extra state.
    const status = await plopProvider.checkStatus(reference, "disburse");

    if (status.status === "success") {
      const { error: rpcError } = await supabaseAdmin.rpc("complete_pending_payout_secure", {
        _transaction_reference: reference,
        _provider_code: row.provider_code,
        _provider_transaction_id: status.providerReference,
      });
      if (rpcError) throw new Error(rpcError.message);
      results.push({ transactionReference: reference, outcome: "confirmed" });
    } else if (status.status === "failed") {
      const { error: rpcError } = await supabaseAdmin.rpc("fail_pending_payout_secure", {
        _transaction_reference: reference,
        _provider_code: row.provider_code,
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
