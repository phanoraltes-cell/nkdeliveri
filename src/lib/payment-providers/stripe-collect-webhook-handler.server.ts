/**
 * Orchestrates an inbound Stripe webhook for the Collect flow —
 * signature verification, finalizing the payment, notifications. Unlike
 * PLOP (no webhook exists at all — docs/archive/plop/PLOP_PHASE0_AUDIT.md § 9), Stripe
 * both supports and recommends webhooks as the primary confirmation path
 * — this handler mirrors moncash-collect-webhook-handler.server.ts's own
 * shape closely (same idempotency reasoning, same RPC), adapted for
 * Stripe's event model. Called only by
 * src/routes/api.webhooks.stripe.collect.ts via a dynamic import — same
 * reasoning as every other webhook route in this codebase (a static
 * import here would pull the service-role client into the client
 * bundle).
 *
 * Idempotency: `complete_collect_payment_secure`'s own
 * `UPDATE ... WHERE status = 'pending'` guard is the whole guarantee — a
 * replayed delivery for an already-decided transaction affects 0 rows and
 * is treated as a safe no-op, exactly like the MonCash collect handler.
 */
import type { Json } from "@/integrations/supabase/types";
import type { PaymentWebhookEvent } from "./types";

export type StripeWebhookHandlerResult = {
  httpStatus: number;
  body: { ok: boolean; outcome: string; error?: string };
};

type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

export async function handleStripeCollectWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<StripeWebhookHandlerResult> {
  const { stripeProvider } = await import("./stripe-provider.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const verified = await stripeProvider.verifyWebhook(rawBody, headers);
  if (!verified.valid) {
    console.warn("[stripe-collect-webhook] rejected: signature invalid or unparseable payload");
    return { httpStatus: 401, body: { ok: false, outcome: "rejected", error: verified.error } };
  }

  const event = verified.event;
  if (!event.ourReference) {
    // No client_reference_id on this session — nothing to match back to
    // a payment_transactions row. Not an error (genuinely from Stripe,
    // just not one this integration can act on), acknowledged so Stripe
    // doesn't retry it forever.
    return { httpStatus: 200, body: { ok: true, outcome: "ignored" } };
  }

  try {
    const outcome = await applyEvent(supabaseAdmin, event);
    return { httpStatus: 200, body: { ok: true, outcome } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-collect-webhook] processing failed", message);
    // 500, not 200: our own transient failure (DB error, RPC exception),
    // not a permanent rejection — Stripe automatically retries a
    // non-2xx response, safe to reprocess (complete_collect_payment_secure's
    // own guard makes a second successful attempt idempotent regardless).
    return { httpStatus: 500, body: { ok: false, outcome: "error", error: message } };
  }
}

async function applyEvent(
  supabaseAdmin: SupabaseAdmin,
  event: PaymentWebhookEvent,
): Promise<"paid" | "failed" | "ignored"> {
  if (event.status === "pending") {
    // "checkout.session.completed" with a payment_status other than
    // "paid" (e.g. a delayed payment method still processing) — nothing
    // to finalize yet, wait for a later delivery
    // ("checkout.session.async_payment_succeeded"/"_failed", not
    // currently subscribed to in the Stripe dashboard — a known
    // limitation, see docs/archive/audits/STRIPE_INTEGRATION_REPORT.md).
    return "ignored";
  }

  const decision = event.status === "success" ? "paid" : "failed";
  const { data: row, error } = await supabaseAdmin.rpc("complete_collect_payment_secure", {
    _external_reference: event.ourReference as string,
    _decision: decision,
    _provider_transaction_id: event.providerReference,
    _error: decision === "failed" ? "Sesyon peman Stripe a ekspire san peman" : undefined,
    _webhook_data: sanitizeWebhookPayload(event.raw) as Json,
  });
  if (error) throw new Error(error.message);
  return row.status as "paid" | "failed";
}

/** Same allowlist discipline as plop-client.server.ts's audit logging — never the full raw payload verbatim, only the fields this app actually needs to keep (never card details — Stripe's own webhook payload for a Checkout Session never includes raw card data anyway, but the allowlist stays explicit rather than assumed safe). */
function sanitizeWebhookPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { type?: unknown; data?: { object?: Record<string, unknown> } };
  const session = r.data?.object ?? {};
  return {
    event_type: r.type ?? null,
    session_id: session.id ?? null,
    payment_status: session.payment_status ?? null,
    status: session.status ?? null,
    amount_total: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
}
