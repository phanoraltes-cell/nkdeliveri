/**
 * Tach 3B (PROMPT MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) — self-service
 * withdrawal orchestration for a restaurant/driver. The DB side
 * (request_withdrawal_secure) only reserves the funds and creates a
 * 'requested' row — it cannot call PLOP itself (a SECURITY DEFINER
 * Postgres function has no outbound network access). This module submits
 * the request, then immediately hands the fresh row to
 * attempt-withdrawal-provider.logic.ts — the same "try PLOP now" step an
 * admin can later re-trigger manually from the admin dashboard for a
 * request that stayed 'requested'.
 *
 * When PLOP isn't configured/active yet (payment_providers.is_active is
 * false until Altes runs a real controlled test — see
 * 20260901060000_activate_plop_disbursement.sql), this stops after the
 * request: it stays 'requested' for an admin to process manually via
 * admin_mark_requested_withdrawal_paid_secure. Nothing about this module
 * changes once PLOP is activated — the exact same code path starts
 * completing automatically.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { attemptWithdrawalProvider } from "@/lib/attempt-withdrawal-provider.logic";

export const RequestWithdrawalInputSchema = z
  .object({
    restaurantId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    amount: z.number().positive(),
    method: z.enum(["moncash", "natcash"]),
  })
  .refine((d) => Boolean(d.restaurantId) !== Boolean(d.driverId), {
    message: "Specify exactly one beneficiary",
  });
export type RequestWithdrawalInput = z.infer<typeof RequestWithdrawalInputSchema>;

type PayoutRow = Database["public"]["Tables"]["payouts"]["Row"];

export type RequestWithdrawalResult =
  | { outcome: "requested"; payout: PayoutRow }
  | { outcome: "pending"; payout: PayoutRow }
  | { outcome: "success"; payout: PayoutRow }
  | { outcome: "failed"; payout: PayoutRow; error: string };

export async function runRequestWithdrawal(
  supabase: SupabaseClient<Database>,
  data: RequestWithdrawalInput,
): Promise<RequestWithdrawalResult> {
  // Reserve the funds, create the 'requested' row. Every real validation
  // (ownership, minimum, daily limit, frozen account, account-change
  // cooldown, available balance) lives here, server-side.
  const { data: requested, error: requestError } = await supabase.rpc("request_withdrawal_secure", {
    _restaurant_id: data.restaurantId,
    _driver_id: data.driverId,
    _amount: data.amount,
    _method: data.method,
  });
  if (requestError) throw new Error(requestError.message);

  const attempt = await attemptWithdrawalProvider(supabase, requested);
  if (attempt.outcome === "not_configured") {
    // Not configured/active at the application layer — stays 'requested'
    // for an admin to process manually. Not an error: this is the
    // expected, honest state until a real integration/activation exists.
    return { outcome: "requested", payout: requested };
  }
  return attempt;
}
