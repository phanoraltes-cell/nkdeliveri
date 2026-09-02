/**
 * Tach 3B — the shared "try PLOP now" step for a payout row already sitting
 * at status 'requested', extracted so BOTH the beneficiary's own immediate
 * attempt (request-withdrawal.logic.ts, right after they submit) and an
 * admin's manual "eseye otomatikman" retry (dashboard.admin.payouts.tsx,
 * for a request that stayed 'requested' — e.g. PLOP was inactive at
 * request time but has since been activated) go through the exact same
 * code, never two copies of money-moving logic that could drift apart.
 *
 * Authorization is enforced by the RPCs themselves
 * (mark_requested_withdrawal_processing_secure accepts the beneficiary OR
 * an admin, via private.payout_beneficiary_visible) — this module adds no
 * extra check of its own, matching every other *.logic.ts file in this
 * project.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type PayoutRow = Database["public"]["Tables"]["payouts"]["Row"];

export type AttemptWithdrawalProviderResult =
  | { outcome: "not_configured"; payout: PayoutRow }
  /** Tach 3D — the rule's availability_delay_hours hasn't elapsed since the request was created yet (ERRCODE 55000 from mark_requested_withdrawal_processing_secure/admin_mark_requested_withdrawal_paid_secure). Distinct from "not_configured" so the caller shows the real reason, not a misleading "PLOP isn't set up" message. */
  | { outcome: "not_yet_available"; payout: PayoutRow; error: string }
  | { outcome: "pending"; payout: PayoutRow }
  | { outcome: "success"; payout: PayoutRow }
  | { outcome: "failed"; payout: PayoutRow; error: string };

/** `payout` must currently be status:'requested' — pass the row already in hand (from request_withdrawal_secure or a list query) so this never re-fetches it under a weaker RLS lens than the caller already had. */
export async function attemptWithdrawalProvider(
  supabase: SupabaseClient<Database>,
  payout: PayoutRow,
): Promise<AttemptWithdrawalProviderResult> {
  const method = payout.method as "moncash" | "natcash";
  const providerCode = method === "moncash" ? "moncash_api" : "natcash_api";

  const { getPaymentProvider } = await import("@/lib/payment-providers/index.server");
  const provider = getPaymentProvider(providerCode);
  if (!provider || !provider.isConfigured()) {
    return { outcome: "not_configured", payout };
  }

  const idempotencyKey = crypto.randomUUID();

  const { data: processing, error: markError } = await supabase.rpc(
    "mark_requested_withdrawal_processing_secure",
    { _payout_id: payout.id, _provider_code: providerCode, _own_reference: idempotencyKey },
  );
  if (markError) {
    if (markError.code === "55000") {
      return { outcome: "not_yet_available", payout, error: markError.message };
    }
    return { outcome: "not_configured", payout };
  }

  // Tach 3D — the beneficiary receives net_amount (amount minus the
  // withdrawal_rules fee, already computed and snapshotted at request
  // time); the wallet reserved the gross `amount`, but only the net
  // figure is ever actually wired out.
  const result = await provider.initiatePayment({
    direction: "disburse",
    amount: processing.net_amount,
    counterpartyNumber: processing.receiver_number,
    counterpartyName: processing.receiver_account_name,
    reference: idempotencyKey,
    paymentMethod: method,
  });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (result.status === "success") {
    const { data: finalRow, error: completeError } = await supabaseAdmin.rpc(
      "complete_pending_payout_secure",
      {
        _transaction_reference: idempotencyKey,
        _provider_code: providerCode,
        _provider_transaction_id: result.providerReference,
      },
    );
    if (completeError) throw new Error(completeError.message);
    return { outcome: "success", payout: finalRow };
  }

  if (result.status === "pending") {
    return { outcome: "pending", payout: processing };
  }

  const { data: failedRow, error: failError } = await supabaseAdmin.rpc(
    "fail_pending_payout_secure",
    { _transaction_reference: idempotencyKey, _provider_code: providerCode, _reason: result.error },
  );
  if (failError) throw new Error(failError.message);
  return { outcome: "failed", payout: failedRow, error: result.error };
}
