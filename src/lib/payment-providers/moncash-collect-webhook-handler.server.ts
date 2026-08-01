/**
 * Orchestrates an inbound MonCash webhook for the *collect* (customer →
 * platform) flow — signature verification, idempotency, finalizing the
 * payment, notifications. Deliberately separate from
 * moncash-webhook-handler.server.ts (disbursement) — different table
 * (`payment_transactions`, never `moncash_webhook_events`), different
 * RPC (`complete_collect_payment_secure`, never
 * complete/fail_pending_payout_secure), different route. Called only by
 * src/routes/api.webhooks.moncash.collect.ts via a dynamic import — see
 * that file's own comment for why a static import isn't safe here.
 *
 * Idempotency here has one layer, not two: complete_collect_payment_secure's
 * own `UPDATE ... WHERE status = 'pending'` guard is the whole guarantee
 * — a replayed delivery for an already-decided transaction affects 0
 * rows and is treated as a safe no-op. No separate webhook-events ledger
 * is needed the way moncash_webhook_events is for disbursement: a
 * payment_transactions row for a given external_reference always exists
 * *before* any webhook for it can possibly arrive (created synchronously
 * by create_collect_payment_secure right after MonCash accepts the
 * request), so there is no "webhook arrives before we know about the
 * reference" race to guard against the way disbursement's asynchronous
 * creation path has.
 */
import type { Json } from "@/integrations/supabase/types";
import type { PaymentWebhookEvent } from "./types";

export type CollectWebhookHandlerResult = {
  httpStatus: number;
  body: { ok: boolean; outcome: string; error?: string };
};

type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

export async function handleMonCashCollectWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<CollectWebhookHandlerResult> {
  const { moncashProvider } = await import("./moncash-provider.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const verified = await moncashProvider.verifyWebhook(rawBody, headers);
  if (!verified.valid) {
    console.warn("[moncash-collect-webhook] rejected: signature invalid or unparseable payload");
    return { httpStatus: 401, body: { ok: false, outcome: "rejected", error: verified.error } };
  }

  const event = verified.event;
  if (!event.ourReference) {
    // No way to match this back to a payment_transactions row — nothing
    // to finalize. Not an error (MonCash sent something genuine, just
    // not one we can act on), acknowledged so it isn't retried forever.
    return { httpStatus: 200, body: { ok: true, outcome: "ignored" } };
  }

  try {
    const outcome = await applyEvent(supabaseAdmin, event);
    return { httpStatus: 200, body: { ok: true, outcome } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[moncash-collect-webhook] processing failed", message);
    // 500, not 200: our own transient failure (DB error, RPC exception),
    // not a permanent rejection -- a legitimate MonCash retry should try
    // again, safe to reprocess (complete_collect_payment_secure's own
    // guard makes a second successful attempt idempotent regardless).
    return { httpStatus: 500, body: { ok: false, outcome: "error", error: message } };
  }
}

async function applyEvent(
  supabaseAdmin: SupabaseAdmin,
  event: PaymentWebhookEvent,
): Promise<"paid" | "failed" | "ignored"> {
  if (event.status === "pending") {
    // Nothing to finalize yet -- wait for a later delivery.
    return "ignored";
  }

  const decision = event.status === "success" ? "paid" : "failed";
  // Idempotent by construction: a replayed delivery for an
  // already-decided transaction still succeeds here (the RPC returns
  // the row as-is, unchanged) -- it only ever throws for a reference
  // that never existed at all (P0002), which we let propagate as a
  // genuine error rather than a silent "unknown" outcome.
  const { data: row, error } = await supabaseAdmin.rpc("complete_collect_payment_secure", {
    _external_reference: event.ourReference as string,
    _decision: decision,
    _provider_transaction_id: event.providerReference,
    _error: decision === "failed" ? "MonCash rapòte tranzaksyon an echwe" : undefined,
    _webhook_data: sanitizeWebhookPayload(event.raw) as Json,
  });
  if (error) throw new Error(error.message);
  return row.status as "paid" | "failed";
}

/** Same allowlist discipline as moncash-client.server.ts's audit logging — never the full raw payload verbatim if it could ever carry something sensitive, only the fields this app actually needs to keep. */
function sanitizeWebhookPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    message: r.message ?? null,
    status: r.status ?? null,
    amount: r.amount ?? r.cost ?? null,
    transaction_id: r.transaction_id ?? null,
    order_id: r.order_id ?? r.orderId ?? null,
  };
}
