import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

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
 */
export async function runInitiateCollectPayment(
  supabase: SupabaseClient<Database>,
  data: InitiateCollectPaymentInput,
): Promise<
  | { outcome: "failed"; error: string }
  | { outcome: "pending"; redirectUrl: string; transaction: PaymentTransactionRow }
> {
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, method, status, amount")
    .eq("id", data.paymentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return { outcome: "failed", error: "Peman pa jwenn" };
  if (payment.method !== "moncash") {
    return { outcome: "failed", error: "MonCash Automatik disponib sèlman pou peman MonCash" };
  }

  // Our own reference, generated fresh every attempt — never derived from
  // anything the client sends, and never itself capable of carrying a
  // secret (a random UUID, nothing more) even though it ends up in logs
  // (moncash_api_logs) and the payment_transactions row. Generated before
  // either gate below so every refusal, not just a provider rejection, is
  // journaled through the same create_collect_payment_secure path.
  const reference = crypto.randomUUID();

  // Backend is the sole source of truth for whether this method may be
  // used at all — checked *before* isConfigured() and before importing
  // the provider module, so a disabled method never even reaches a point
  // where it could call the MonCash API, regardless of what the frontend
  // shows. See docs/PAYMENT_PROVIDER_HARDENING_PHASE0_AUDIT.md.
  const { fetchPaymentProviderSettings, isProviderEnabled, getProviderSetting } =
    await import("@/lib/payment-provider-availability");
  const settings = await fetchPaymentProviderSettings(supabase);
  if (!isProviderEnabled(settings, "moncash_auto")) {
    const message =
      getProviderSetting(settings, "moncash_auto")?.maintenanceMessage ??
      "MonCash Automatik pa disponib pou kounye a.";
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: message,
    });
    if (logError)
      console.warn("[collect] failed to record disabled-provider attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  const { moncashProvider } = await import("@/lib/payment-providers/moncash-provider.server");
  if (!moncashProvider.isConfigured()) {
    const message = "MonCash Automatik pa konfigire toujou";
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: message,
    });
    if (logError)
      console.warn("[collect] failed to record not-configured attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  const result = await moncashProvider.initiatePayment({
    direction: "collect",
    amount: payment.amount,
    reference,
  });

  if (result.status === "failed") {
    // Best-effort — a logging failure must never mask the original
    // provider error from the customer.
    const { error: logError } = await supabase.rpc("create_collect_payment_secure", {
      _payment_id: data.paymentId,
      _external_reference: reference,
      _status: "failed",
      _error: result.error,
    });
    if (logError) console.warn("[collect] failed to record failed attempt", logError.message);
    return { outcome: "failed", error: result.error };
  }

  // "pending" is the only other outcome direction:"collect" ever returns
  // on success — MonCash's CreatePayment issues a redirect token, never
  // an immediate confirmation ("success" here would mean the idempotent
  // reconciliation path found an already-completed transaction for this
  // brand-new reference, which cannot happen right after generating it).
  const { data: transaction, error: rpcError } = await supabase.rpc(
    "create_collect_payment_secure",
    { _payment_id: data.paymentId, _external_reference: reference, _status: "pending" },
  );
  if (rpcError) throw new Error(rpcError.message);

  const raw = result.raw as { redirectUrl?: string } | undefined;
  if (!raw?.redirectUrl) {
    return { outcome: "failed", error: "MonCash pa retounen yon lyen peman" };
  }

  return { outcome: "pending", redirectUrl: raw.redirectUrl, transaction };
}
