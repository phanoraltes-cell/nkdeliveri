/**
 * Daily safety-net reconciliation for PLOP Collect payments stuck in
 * `pending` — see the "rôle du cron" callout in
 * docs/PLOP_PHASE1_ARCHITECTURE.md § 3: this is explicitly NOT the
 * primary confirmation mechanism (that's the client-side adaptive poll on
 * orders.$id.tsx). This job only:
 *   1. Recovers abandoned payments — the user closed the tab before the
 *      client-side poll could resolve anything.
 *   2. Finalizes payments that were never rechecked at all — the browser
 *      closed immediately after redirecting to PLOP, before the poll
 *      even had a chance to start.
 *   3. Flags stale, inconsistent state for manual admin review — never
 *      guesses a `failed` decision from silence alone.
 *
 * Runs once a day (Vercel Cron — see src/routes/api.cron.plop-reconcile.ts
 * and vercel.json), a hard ceiling imposed by the project's Vercel Hobby
 * plan (docs/MONCASH_CRON_SECRET_CONFIGURATION_REPORT.md § 2, already hit
 * by moncash-reconcile.server.ts). No progressive backoff schedule is
 * needed at this cadence, unlike moncash-reconcile.server.ts's
 * 30s/2min/10min tiers — every still-pending candidate old enough is
 * simply rechecked once per daily pass.
 *
 * Goes through `plopProvider.checkStatus()` (the provider layer) rather
 * than calling `verifyPayment()` (the low-level client) directly — same
 * pattern as moncash-reconcile.server.ts's own `moncashProvider
 * .checkStatus()` call. Audit finding A6 (docs/PLOP_PHASE2_AUDIT.md §
 * Dette technique): calling the raw client here would duplicate
 * `trans_status` interpretation outside the one place meant to own it,
 * and silently drift out of sync with it over time.
 */
import type { Json } from "@/integrations/supabase/types";
import { plopProvider } from "./plop-provider.server";

/** Give the client-side poll (orders.$id.tsx) a real chance to resolve this on its own before the cron ever looks at it. */
const MIN_AGE_MS = 10 * 60_000;
/** Beyond this, silence is no longer "still waiting" — flag for a human rather than continuing to poll forever. */
const STALE_REVIEW_AFTER_MS = 3 * 24 * 60 * 60_000;

export type ReconcileOutcome =
  | "confirmed"
  | "still_pending"
  | "needs_manual_review"
  /** trans_status was confirmed "ok" by PLOP but the RPC that records it failed — a more urgent case than ordinary waiting (audit finding A3, docs/PLOP_PHASE2_AUDIT.md § Anomalies): the customer's money is accounted for on PLOP's side but not yet reflected here, and needs to be retried, not merely watched. */
  | "rpc_error";

export type ReconcileResult = {
  externalReference: string;
  outcome: ReconcileOutcome;
};

export type ReconcileSummary = {
  candidates: number;
  results: ReconcileResult[];
};

type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

async function finalizeAsPaid(
  supabaseAdmin: SupabaseAdmin,
  reference: string,
  providerTransactionId: string | undefined,
  walletUsed: string | null | undefined,
  raw: unknown,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("complete_collect_payment_secure", {
    _external_reference: reference,
    _decision: "paid",
    _provider_transaction_id: providerTransactionId,
    _webhook_data: (raw ?? null) as Json,
    _payment_method_used: walletUsed ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Escalates a transaction stuck past `STALE_REVIEW_AFTER_MS` — the real
 * gap found during docs/BACKEND_PAYMENT_REMEDIATION.md: this cron already
 * detected staleness correctly, but the only signal was a console.error,
 * invisible without direct Vercel log access. `flag_stale_collect_payment_secure`
 * (SQL, idempotent via `payment_transactions.stale_flagged_at`) fires the
 * in-app bell exactly once via `private.notify_secure`; this function is
 * the matching push-notification sibling this project's own convention
 * requires ([[project_notification_push_convention]]) — reached directly
 * (no `send-*-push.functions.ts`/`createServerFn` wrapper, since this runs
 * in a cron context with no user session to authenticate, unlike every
 * client-triggered push in this codebase).
 */
async function flagStaleAndNotify(supabaseAdmin: SupabaseAdmin, reference: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("flag_stale_collect_payment_secure", {
    _external_reference: reference,
  });
  if (error) throw new Error(error.message);
  const flagged = data?.[0];
  if (!flagged?.just_flagged) return; // already flagged on a previous day's run — no repeat push

  const { data: admins, error: adminsError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "super_admin"]);
  if (adminsError) throw new Error(adminsError.message);
  const adminIds = (admins ?? []).map((r) => r.user_id);
  if (adminIds.length === 0) return;

  const { pushToUsers } = await import("@/lib/push-dispatch.server");
  await pushToUsers(adminIds, {
    title: "Peman otomatik bloke depi plizyè jou",
    body: `Yon tantativ peman ${flagged.amount ?? "?"} HTG rete "an atant" depi plis pase 3 jou — verifye li manyèlman.`,
    url: "/dashboard/admin/collect",
    tag: `collect-payment-stale-${reference}`,
    data: {
      paymentId: flagged.payment_id,
      orderId: flagged.order_id,
      externalReference: reference,
    },
  });
}

/**
 * Finds every `pending` PLOP Collect transaction old enough to check,
 * asks PLOP directly for its real status via `plopProvider.checkStatus()`,
 * and finalizes confirmed payments through the same RPC the (currently
 * dormant, PLOP-unused) webhook path would have used —
 * `complete_collect_payment_secure` — never touching `payments`/
 * `payment_transactions` directly. Never marks anything `failed`
 * automatically: PLOP documents only two `trans_status` values, and a
 * payment that never resolves is a case for manual review, not a guessed
 * failure that could reject money the customer actually paid.
 */
export async function reconcilePendingPlopPayments(): Promise<ReconcileSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("payment_transactions")
    .select("external_reference, created_at")
    .eq("provider", "moncash_api")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - MIN_AGE_MS).toISOString());
  if (error) throw new Error(error.message);

  const results: ReconcileResult[] = [];

  for (const row of pending ?? []) {
    const reference = row.external_reference;

    // checkStatus() never throws — a network/API failure while checking
    // is already folded into status:"unknown" by the provider layer, so
    // no try/catch is needed around this call itself (unlike calling
    // verifyPayment() directly, which can reject). Only the RPC call
    // below (a real side effect) still needs one.
    const status = await plopProvider.checkStatus(reference);

    if (status.status === "success") {
      try {
        await finalizeAsPaid(
          supabaseAdmin,
          reference,
          status.providerReference,
          status.walletUsed,
          status.raw,
        );
        results.push({ externalReference: reference, outcome: "confirmed" });
      } catch (err) {
        // PLOP confirmed the payment but recording it here failed — a
        // more urgent situation than ordinary waiting (audit finding A3):
        // the customer's money is accounted for, ours isn't yet. Logged
        // distinctly (console.error, not console.warn) so it stands out
        // in Vercel logs rather than blending into normal "still
        // pending" noise; retried automatically on tomorrow's pass since
        // the payment_transactions row is still 'pending'.
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[plop-reconcile] RPC FAILED AFTER PLOP CONFIRMED — ${reference} is paid on PLOP's side but complete_collect_payment_secure failed: ${message}`,
        );
        results.push({ externalReference: reference, outcome: "rpc_error" });
      }
      continue;
    }

    // status is "pending" or "unknown" here — both treated the same way
    // for staleness purposes (docs/PLOP_PHASE2_AUDIT.md § Anomalie A2:
    // "unknown" must never be treated as a failure, only ever as "we
    // still don't have a definitive answer").
    const isStale = Date.now() - new Date(row.created_at).getTime() > STALE_REVIEW_AFTER_MS;
    if (isStale) {
      // Escalates once, not merely logging — docs/BACKEND_PAYMENT_REMEDIATION.md:
      // a console.error alone was found to be genuinely invisible in
      // production (16 real stuck transactions, zero admin notifications,
      // zero pushes, confirmed by direct data audit). flag_stale_collect_payment_secure
      // is idempotent (payment_transactions.stale_flagged_at) — safe to
      // call every day for the same still-pending transaction, it only
      // ever fires the in-app bell/push once.
      console.error(
        `[plop-reconcile] transaction ${reference} still pending after ${STALE_REVIEW_AFTER_MS / 86_400_000} days — flagging for manual review`,
      );
      try {
        await flagStaleAndNotify(supabaseAdmin, reference);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[plop-reconcile] failed to flag ${reference} as stale: ${message}`);
      }
      results.push({ externalReference: reference, outcome: "needs_manual_review" });
      continue;
    }

    results.push({ externalReference: reference, outcome: "still_pending" });
  }

  return { candidates: pending?.length ?? 0, results };
}
