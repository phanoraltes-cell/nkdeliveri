/**
 * Orchestration logic behind the client-side adaptive poll
 * (useCollectPaymentPoll, orders.$id.tsx) — the PRIMARY confirmation
 * mechanism for a PLOP Collect payment, not the daily reconciliation
 * cron (docs/PLOP_PHASE1_ARCHITECTURE.md § 3/§ 3bis). Kept in its own
 * plain module for the same testability reason as
 * initiate-collect-payment.logic.ts: importable from a unit test without
 * dragging in TanStack Start's createServerFn runtime.
 *
 * Security model: the *lookup* (step 1) runs through the caller's own
 * authenticated, RLS-scoped `supabase` client — never `supabaseAdmin` —
 * so a customer can only ever poll a `payment_transactions` row their
 * own `orders` row actually owns (the existing "payment_transactions own
 * read" RLS policy, unchanged since Phase 0). Only the *finalization*
 * (step 3, once PLOP has genuinely confirmed) needs `supabaseAdmin`,
 * exactly mirroring the webhook handler's own privilege split
 * (moncash-collect-webhook-handler.server.ts) — this function is simply
 * a second, polling-triggered caller of the same
 * `complete_collect_payment_secure` RPC, never a new way to reach it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { z } from "zod";

export const PollCollectPaymentInputSchema = z.object({ externalReference: z.string().uuid() });
export type PollCollectPaymentInput = z.infer<typeof PollCollectPaymentInputSchema>;

export type PollCollectPaymentResult =
  { status: "pending" } | { status: "paid" | "failed" } | { status: "not_found" };

/** Per-customer ceiling, independent of and in addition to the client-side pacing (useCollectPaymentPoll) — defends against a scripted caller bypassing the browser's own timer. Generous enough for the legitimate worst case (§ 3bis: ≤31 ticks/15min) with headroom for jitter and a page reload restarting the sequence. */
const RATE_LIMIT_MAX_HITS = 40;
const RATE_LIMIT_WINDOW_SECONDS = 900;

export async function runPollCollectPayment(
  supabase: SupabaseClient<Database>,
  data: PollCollectPaymentInput,
): Promise<PollCollectPaymentResult> {
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_rate_limit_secure", {
    _action: "poll_collect_payment",
    _max_hits: RATE_LIMIT_MAX_HITS,
    _window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (rateLimitError) throw new Error(rateLimitError.message);
  if (!allowed) {
    // Never leak *why* to a scripted caller beyond "not pending" — the
    // legitimate browser-side poll simply backs off; there is no
    // customer-facing UI for this case (§ orders.$id.tsx never surfaces
    // a rate-limit message, it just stops polling for this cycle).
    return { status: "pending" };
  }

  // Step 1 — authorized lookup, RLS-scoped to the caller's own orders.
  const { data: row, error } = await supabase
    .from("payment_transactions")
    .select("status, external_reference")
    .eq("external_reference", data.externalReference)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { status: "not_found" };
  if (row.status !== "pending") {
    // Already decided (by the cron, a previous poll tick, or — even
    // though PLOP documents no webhook — defensively, anything else
    // that might finalize it) — nothing left to do, tell the client to
    // stop polling.
    return { status: row.status as "paid" | "failed" };
  }

  // Step 2 — ask PLOP directly. Never throws (plopProvider.checkStatus()
  // folds every failure into status:"unknown" — docs/PLOP_PHASE2_AUDIT.md
  // § A7); "unknown" and "pending" are both reported to the client as
  // "pending" here, same principle as plop-reconcile.server.ts (§ A2:
  // never treat an ambiguous answer as a failure).
  const { plopProvider } = await import("@/lib/payment-providers/plop-provider.server");
  const status = await plopProvider.checkStatus(data.externalReference);

  if (status.status !== "success") {
    return { status: "pending" };
  }

  // Step 3 — finalize. service_role-only RPC, hence supabaseAdmin here
  // and nowhere else in this function.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: updated, error: rpcError } = await supabaseAdmin.rpc(
    "complete_collect_payment_secure",
    {
      _external_reference: data.externalReference,
      _decision: "paid",
      _provider_transaction_id: status.providerReference,
      _webhook_data: (status.raw ?? null) as Json,
      _payment_method_used: status.walletUsed ?? undefined,
    },
  );
  if (rpcError) throw new Error(rpcError.message);

  return { status: updated.status as "paid" | "failed" };
}
