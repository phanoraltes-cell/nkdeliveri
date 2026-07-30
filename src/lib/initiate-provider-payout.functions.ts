import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
 *   3. Only on a *confirmed* success does this ever touch the ledger —
 *      by calling initiate_payout_secure exactly as the manual flow does,
 *      with the provider's own transaction reference (never a
 *      client-supplied one) as `_transaction_reference`. A failed or
 *      still-pending provider result returns without calling it, so the
 *      wallet is never debited for a transfer that didn't (yet) happen.
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
      return {
        outcome: "failed" as const,
        error: `${data.providerCode} pa konfigire toujou — itilize peman manyèl la.`,
      };
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

    if (result.status !== "success") {
      return {
        outcome: result.status === "pending" ? ("pending" as const) : ("failed" as const),
        error:
          result.status === "failed" ? result.error : "Peman an an atant konfimasyon pwovidè a",
      };
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
