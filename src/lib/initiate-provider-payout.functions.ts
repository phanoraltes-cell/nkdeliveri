import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPaymentProvider } from "@/lib/payment-providers/index.server";

const InputSchema = z
  .object({
    restaurantId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    amount: z.number().positive(),
    method: z.enum(["moncash", "natcash"]),
    providerCode: z.enum(["moncash_api", "natcash_api"]),
    notes: z.string().optional(),
  })
  .refine((d) => Boolean(d.restaurantId) !== Boolean(d.driverId), {
    message: "Specify exactly one beneficiary",
  });

/**
 * The *only* place in the app allowed to call a payment provider's
 * initiatePayment() for a payout — never from a component, never from
 * payout-pay-modal.tsx directly (see payment-providers/types.ts). Mirrors
 * the manual flow's own two-step shape (send the money, then record it),
 * except here step one is a real API call instead of an admin's thumb:
 *
 *   1. Look up the beneficiary's receiver number for the chosen rail.
 *   2. Ask the provider to execute the transfer.
 *   3. On an immediate success, call initiate_payout_secure exactly as
 *      the manual flow does, with the provider's own transaction
 *      reference (never a client-supplied one) as `_transaction_reference`.
 *   4. On a *pending* result (the provider accepted the request but
 *      hasn't confirmed completion), call create_pending_payout_secure
 *      instead — reserves the funds without treating the transfer as
 *      done. A later webhook delivery (moncash-webhook-handler.server.ts)
 *      or manual reconciliation finalizes it via
 *      complete_pending_payout_secure/fail_pending_payout_secure.
 *   5. On a failed result, nothing touches the ledger at all — the
 *      wallet is never debited for a transfer that didn't happen.
 *
 * Inert today by construction: getPaymentProvider(...).isConfigured() is
 * false for every non-manual provider until a real integration replaces
 * its stub, so this always returns a clear "not configured" failure —
 * exactly like attempting to select moncash_api in the payout form, which
 * the UI already disables via payment_providers.is_active.
 */
export const initiateProviderPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const provider = getPaymentProvider(data.providerCode);
    if (!provider || !provider.isConfigured()) {
      const error = `${data.providerCode} pa konfigire toujou — itilize peman manyèl la.`;
      await logProviderError(supabase, data, error, "not_configured");
      return { outcome: "failed" as const, error };
    }

    const receiverColumn = data.method === "moncash" ? "moncash_number" : "natcash_number";
    const receiverAccountColumn =
      data.method === "moncash" ? "moncash_account_name" : "natcash_account_name";

    let receiverNumber: string | null = null;
    let receiverAccountName: string | null = null;
    if (data.restaurantId) {
      const { data: pd, error } = await supabase
        .from("restaurant_payout_details")
        .select(`${receiverColumn}, ${receiverAccountColumn}`)
        .eq("restaurant_id", data.restaurantId)
        .maybeSingle<Record<string, string | null>>();
      if (error) throw new Error(error.message);
      receiverNumber = pd?.[receiverColumn] ?? null;
      receiverAccountName = pd?.[receiverAccountColumn] ?? null;
    } else if (data.driverId) {
      const { data: dr, error } = await supabase
        .from("drivers")
        .select(`${receiverColumn}, ${receiverAccountColumn}`)
        .eq("id", data.driverId)
        .maybeSingle<Record<string, string | null>>();
      if (error) throw new Error(error.message);
      receiverNumber = dr?.[receiverColumn] ?? null;
      receiverAccountName = dr?.[receiverAccountColumn] ?? null;
    }
    if (!receiverNumber) {
      return { outcome: "failed" as const, error: "Benefisyè a poko konfigire nimewo peman sa a" };
    }

    const idempotencyKey = crypto.randomUUID();
    const result = await provider.initiatePayment({
      direction: "disburse",
      amount: data.amount,
      counterpartyNumber: receiverNumber,
      counterpartyName: receiverAccountName,
      reference: idempotencyKey,
      description: data.notes,
    });

    if (result.status === "failed") {
      await logProviderError(supabase, data, result.error, result.code);
      return { outcome: "failed" as const, error: result.error };
    }

    if (result.status === "pending") {
      const { data: payout, error: pendingError } = await supabase.rpc(
        "create_pending_payout_secure",
        {
          _restaurant_id: data.restaurantId,
          _driver_id: data.driverId,
          _amount: data.amount,
          _method: data.method,
          _own_reference: idempotencyKey,
          _notes: data.notes,
          _provider_code: data.providerCode,
        },
      );
      if (pendingError) throw new Error(pendingError.message);
      return { outcome: "pending" as const, payout };
    }

    const { data: payout, error: rpcError } = await supabase.rpc("initiate_payout_secure", {
      _restaurant_id: data.restaurantId,
      _driver_id: data.driverId,
      _amount: data.amount,
      _method: data.method,
      _transaction_reference: result.providerReference,
      _notes: data.notes,
      _provider_code: data.providerCode,
    });
    if (rpcError) throw new Error(rpcError.message);

    return { outcome: "success" as const, payout };
  });

/**
 * Best-effort — a logging failure must never mask the original provider
 * error from the caller, so this only ever warns, never throws.
 */
async function logProviderError(
  supabase: SupabaseClient<Database>,
  data: z.infer<typeof InputSchema>,
  error: string,
  code?: string,
): Promise<void> {
  const { error: logError } = await supabase.rpc("log_payment_provider_error_secure", {
    _provider_code: data.providerCode,
    _method: data.method,
    _restaurant_id: data.restaurantId,
    _driver_id: data.driverId,
    _amount: data.amount,
    _error: error,
    _code: code,
  });
  if (logError) console.warn("[moncash] failed to log provider error", logError.message);
}
