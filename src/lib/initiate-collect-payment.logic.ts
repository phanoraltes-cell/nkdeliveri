import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { absoluteUrl } from "@/lib/site-config";

export const InitiateCollectPaymentInputSchema = z.object({ paymentId: z.string().uuid() });
export type InitiateCollectPaymentInput = z.infer<typeof InitiateCollectPaymentInputSchema>;

type PaymentTransactionRow = Database["public"]["Tables"]["payment_transactions"]["Row"];

/**
 * The actual orchestration logic — kept in its own plain module, never
 * touching `createServerFn`, specifically so it's importable from a unit
 * test without dragging in TanStack Start's server-function runtime
 * (which has no equivalent outside a real request context and hangs
 * when a test imports a module that calls createServerFn() at the top
 * level). initiate-collect-payment.functions.ts is the only thing that
 * wraps this for real use — same behavior either way, this file is pure
 * refactor-for-testability, not a design change.
 *
 * Phase 3 (PLOP wiring, docs/PLOP_PHASE3_WIRING_REPORT.md): the provider
 * behind "MonCash Otomatik" (`moncash_auto`) and "NatCash Otomatik"
 * (`natcash_auto`) is `plopProvider`
 * (payment-providers/plop-provider.server.ts, docs/PLOP_NATCASH_INTEGRATION_PLAN.md).
 * "Kat Kredi" (`stripe`, docs/STRIPE_INTEGRATION_REPORT.md) is
 * `stripeProvider` instead. This function only ever talks to the generic
 * `PaymentProvider` interface and knows no provider-specific detail — see
 * the `provider` dispatch below for the only place that decides which
 * concrete implementation a given payment actually uses.
 */
export async function runInitiateCollectPayment(
  supabase: SupabaseClient<Database>,
  data: InitiateCollectPaymentInput,
): Promise<
  | { outcome: "failed"; error: string }
  | { outcome: "pending"; redirectUrl: string; transaction: PaymentTransactionRow }
  /**
   * `plopProvider.initiatePayment()` can — rarely — resolve to
   * `status:"success"` immediately (its own reconciliation-on-error path,
   * docs/PLOP_PHASE2_AUDIT.md § A1: a create call that errored on our
   * side but PLOP already has confirmed on theirs). There is no redirect
   * URL to send the customer to in that case — they have nothing left to
   * do — so this is a distinct outcome from "pending", never forced into
   * it (an earlier version of this function assumed "pending" was the
   * only non-failure outcome, which would have shown a successful
   * payment to the customer as a failure — caught during Phase 3 wiring,
   * never shipped).
   */
  | { outcome: "already_confirmed"; transaction: PaymentTransactionRow }
> {
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, method, status, amount, order_id")
    .eq("id", data.paymentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return { outcome: "failed", error: "Peman pa jwenn" };
  if (payment.method !== "moncash" && payment.method !== "natcash" && payment.method !== "stripe") {
    return {
      outcome: "failed",
      error: "Peman otomatik disponib sèlman pou MonCash, NatCash, oswa Kat Kredi",
    };
  }

  // Our own reference, generated fresh every attempt — never derived from
  // anything the client sends, and never itself capable of carrying a
  // secret (a random UUID, nothing more) even though it ends up in logs
  // (plop_api_logs) and the payment_transactions row. Generated before
  // either gate below so every refusal, not just a provider rejection, is
  // journaled through the same create_collect_payment_secure path.
  const reference = crypto.randomUUID();

  // Backend is the sole source of truth for whether this method may be
  // used at all — checked *before* isConfigured() and before importing
  // the provider module, so a disabled method never even reaches a point
  // where it could call the provider's API, regardless of what the
  // frontend shows. See docs/PAYMENT_PROVIDER_HARDENING_PHASE0_AUDIT.md.
  //
  // MonCash Otomatik, NatCash Otomatik, and Kat Kredi (Stripe) are three
  // *independent* checkout buttons (docs/PLOP_NATCASH_INTEGRATION_PLAN.md,
  // docs/STRIPE_INTEGRATION_REPORT.md) — each has its own row in
  // payment_provider_settings, and each must only ever be gated by its own
  // row. Deriving `providerKey` from `payment.method` here (rather than
  // hardcoding one) is the fix for the exact bug the NatCash plan flagged:
  // without it, disabling one method from the admin dashboard would
  // silently disable the others too, since they'd share a single check
  // regardless of which one a given payment actually was.
  const providerKey =
    payment.method === "natcash"
      ? "natcash_auto"
      : payment.method === "stripe"
        ? "stripe"
        : "moncash_auto";
  const providerLabel =
    payment.method === "natcash"
      ? "NatCash Otomatik"
      : payment.method === "stripe"
        ? "Kat Kredi"
        : "MonCash Otomatik";
  const { fetchPaymentProviderSettings, isProviderEnabled, getProviderSetting } =
    await import("@/lib/payment-provider-availability");
  const settings = await fetchPaymentProviderSettings(supabase);
  if (!isProviderEnabled(settings, providerKey)) {
    const message =
      getProviderSetting(settings, providerKey)?.maintenanceMessage ??
      `${providerLabel} pa disponib pou kounye a.`;
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: message,
      _payment_method_requested: payment.method,
    });
    if (logError)
      console.warn("[collect] failed to record disabled-provider attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  // Dispatch to the real fournisseur behind this checkout method — PLOP
  // for moncash/natcash (docs/PLOP_NATCASH_INTEGRATION_PLAN.md), Stripe
  // for card payments (docs/STRIPE_INTEGRATION_REPORT.md). Never a static
  // top-level import of either — same reasoning both already followed
  // (keeps a route/component from ever accidentally importing a
  // `.server.ts` provider module directly).
  const provider =
    payment.method === "stripe"
      ? (await import("@/lib/payment-providers/stripe-provider.server")).stripeProvider
      : (await import("@/lib/payment-providers/plop-provider.server")).plopProvider;

  if (!provider.isConfigured()) {
    const message = "Peman otomatik pa konfigire toujou";
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: message,
      _payment_method_requested: payment.method,
    });
    if (logError)
      console.warn("[collect] failed to record not-configured attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  // `payment.method` is the order's rail (already narrowed to `"moncash"`,
  // `"natcash"`, or `"stripe"` by the gate above) — passed through as the
  // provider's own `payment_method` rather than relying on a global config
  // default. The bug this fixes for PLOP (docs/PLOP_MULTIWALLET_PHASE0_AUDIT.md
  // § 2): `plop-client.server.ts` previously always used
  // `PLOP_PAYMENT_METHOD`, making it structurally impossible for any
  // caller to select a wallet per transaction — resolved per
  // docs/PLOP_NATCASH_INTEGRATION_PLAN.md. `returnUrl` is only meaningful
  // to Stripe (Checkout Sessions require a real `success_url`/`cancel_url`
  // at creation time, docs/STRIPE_INTEGRATION_REPORT.md) — PLOP documents
  // no such parameter and simply ignores it (docs/PLOP_PHASE0_AUDIT.md § 9),
  // so it's always safe to pass regardless of which provider this is.
  const result = await provider.initiatePayment({
    direction: "collect",
    amount: payment.amount,
    reference,
    paymentMethod: payment.method,
    returnUrl: absoluteUrl(`/orders/${payment.order_id}`),
  });

  if (result.status === "failed") {
    // Best-effort — a logging failure must never mask the original
    // provider error from the customer.
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: result.error,
      _payment_method_requested: payment.method,
    });
    if (logError) console.warn("[collect] failed to record failed attempt", logError.message);
    return { outcome: "failed", error: result.error };
  }

  // `result.status` is "pending" or "success" here — both are recorded
  // identically: create_collect_payment_secure only ever accepts
  // 'pending'/'failed' as a *creation* status (never 'paid' — that's
  // complete_collect_payment_secure's job, service_role-only, which this
  // customer-scoped `supabase` client has no privilege to call). A
  // "success" result doesn't skip this — it's the same row, just already
  // known to be genuinely paid on the provider's side; the client-side
  // poll (orders.$id.tsx) or the daily reconciliation cron will finalize
  // it within moments regardless, exactly as they would for an ordinary
  // "pending" row.
  //
  // `_provider_transaction_id`: PLOP has no equivalent at creation time
  // (`result.providerReference` mirrors our own `reference` for PLOP,
  // redundant to store), but Stripe's Checkout Session id genuinely only
  // exists on Stripe's side and must be persisted now — it's the only way
  // checkStatus()/the poll can look this transaction up later, since
  // Stripe's API has no lookup-by-arbitrary-reference endpoint
  // (docs/STRIPE_INTEGRATION_REPORT.md, stripe-provider.server.ts's own
  // header comment). Passed unconditionally; harmless for PLOP.
  const { data: transaction, error: rpcError } = await supabase.rpc(
    "create_collect_payment_secure",
    {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "pending",
      _payment_method_requested: payment.method,
      _provider_transaction_id: result.providerReference,
    },
  );
  if (rpcError) throw new Error(rpcError.message);

  if (result.status === "success") {
    // Nothing left for the customer to do on a provider page — they've
    // already paid (docs/PLOP_PHASE2_AUDIT.md § A1's reconciliation
    // path). Send them straight to the order page instead of a redirect
    // that would make an already-completed payment look unfinished.
    return { outcome: "already_confirmed", transaction };
  }

  const raw = result.raw as { redirectUrl?: string } | undefined;
  if (!raw?.redirectUrl) {
    return { outcome: "failed", error: `${providerLabel} pa retounen yon lyen peman` };
  }

  return { outcome: "pending", redirectUrl: raw.redirectUrl, transaction };
}
