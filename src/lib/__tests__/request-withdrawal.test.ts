/**
 * Unit tests for runRequestWithdrawal (Tach 3B) — the self-service
 * withdrawal orchestration in request-withdrawal.logic.ts, which
 * immediately hands the fresh 'requested' row to
 * attempt-withdrawal-provider.logic.ts's shared "try PLOP now" step.
 * Both the payment provider registry and the service-role client are
 * mocked; no real network call, no real database write. The RPC-level
 * validation/reservation logic (request_withdrawal_secure,
 * mark_requested_withdrawal_processing_secure) is verified separately
 * against the live schema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitiatePaymentResult } from "../payment-providers/types";

const initiatePaymentMock = vi.fn<(input: unknown) => Promise<InitiatePaymentResult>>();
const isConfiguredMock = vi.fn(() => true);
const getPaymentProviderMock = vi.fn((_code: string) => ({
  isConfigured: () => isConfiguredMock(),
  initiatePayment: (input: unknown) => initiatePaymentMock(input),
}));
vi.mock("@/lib/payment-providers/index.server", () => ({
  getPaymentProvider: (code: string) => getPaymentProviderMock(code),
}));

const completePendingPayoutMock = vi.fn();
const failPendingPayoutMock = vi.fn();
const supabaseAdminRpcMock = vi.fn((fn: string, args: unknown) => {
  if (fn === "complete_pending_payout_secure") return completePendingPayoutMock(args);
  if (fn === "fail_pending_payout_secure") return failPendingPayoutMock(args);
  throw new Error(`unexpected supabaseAdmin.rpc: ${fn}`);
});
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (fn: string, args: unknown) => supabaseAdminRpcMock(fn, args) },
}));

const REQUESTED_ROW = {
  id: "payout-1",
  amount: 500,
  method: "moncash",
  receiver_number: "+50912345678",
  receiver_account_name: "Test Beneficiary",
  status: "requested",
};

function buildSupabase(opts: {
  requestError?: { message: string } | null;
  markError?: { message: string } | null;
  markResult?: unknown;
}) {
  const rpc = vi.fn(async (fn: string, args?: { _method?: string }) => {
    if (fn === "request_withdrawal_secure") {
      const row = { ...REQUESTED_ROW, method: args?._method ?? REQUESTED_ROW.method };
      return { data: opts.requestError ? null : row, error: opts.requestError ?? null };
    }
    if (fn === "mark_requested_withdrawal_processing_secure") {
      return {
        data: opts.markError ? null : (opts.markResult ?? { ...REQUESTED_ROW, status: "pending" }),
        error: opts.markError ?? null,
      };
    }
    throw new Error(`unexpected supabase.rpc: ${fn}`);
  });
  return { rpc } as unknown as Parameters<
    typeof import("../request-withdrawal.logic").runRequestWithdrawal
  >[0];
}

const baseInput = { restaurantId: "rest-1", amount: 500, method: "moncash" as const };

describe("runRequestWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConfiguredMock.mockReturnValue(true);
  });

  it("propagates a request_withdrawal_secure failure (insufficient balance, below minimum, etc.) without ever touching a provider", async () => {
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({ requestError: { message: "Balans disponib la pa ase" } });

    await expect(runRequestWithdrawal(supabase, baseInput)).rejects.toThrow(
      "Balans disponib la pa ase",
    );
    expect(getPaymentProviderMock).not.toHaveBeenCalled();
  });

  it("stays 'requested' (not an error) when the provider isn't configured — the manual admin fallback path", async () => {
    isConfiguredMock.mockReturnValue(false);
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({});

    const result = await runRequestWithdrawal(supabase, baseInput);

    expect(result).toEqual({ outcome: "requested", payout: REQUESTED_ROW });
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("stays 'requested' when mark_requested_withdrawal_processing_secure itself rejects (e.g. payment_providers.is_active is still false server-side)", async () => {
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({ markError: { message: "Pwovidè peman sa a pa disponib" } });

    const result = await runRequestWithdrawal(supabase, baseInput);

    expect(result).toEqual({ outcome: "requested", payout: REQUESTED_ROW });
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("finalizes via complete_pending_payout_secure and reports 'success' when PLOP confirms the transfer immediately", async () => {
    initiatePaymentMock.mockResolvedValue({ status: "success", providerReference: "WD-TX-1" });
    completePendingPayoutMock.mockResolvedValue({
      data: { ...REQUESTED_ROW, status: "paid" },
      error: null,
    });
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({});

    const result = await runRequestWithdrawal(supabase, baseInput);

    expect(result.outcome).toBe("success");
    expect(completePendingPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        _provider_code: "moncash_api",
        _provider_transaction_id: "WD-TX-1",
      }),
    );
    expect(failPendingPayoutMock).not.toHaveBeenCalled();
  });

  it("reports 'pending' and finalizes nothing when PLOP accepts the request but hasn't confirmed yet", async () => {
    initiatePaymentMock.mockResolvedValue({ status: "pending" });
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({});

    const result = await runRequestWithdrawal(supabase, baseInput);

    expect(result.outcome).toBe("pending");
    expect(completePendingPayoutMock).not.toHaveBeenCalled();
    expect(failPendingPayoutMock).not.toHaveBeenCalled();
  });

  it("releases the reservation via fail_pending_payout_secure and reports 'failed' when PLOP rejects the withdrawal", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "failed",
      error: "Balans machann lan pa sifi",
      code: "rejected",
    });
    failPendingPayoutMock.mockResolvedValue({
      data: { ...REQUESTED_ROW, status: "failed" },
      error: null,
    });
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({});

    const result = await runRequestWithdrawal(supabase, baseInput);

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("Balans machann lan pa sifi");
    expect(failPendingPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ _provider_code: "moncash_api" }),
    );
    expect(completePendingPayoutMock).not.toHaveBeenCalled();
  });

  it("routes to natcash_api when method is natcash", async () => {
    initiatePaymentMock.mockResolvedValue({ status: "pending" });
    const { runRequestWithdrawal } = await import("../request-withdrawal.logic");
    const supabase = buildSupabase({
      markResult: { ...REQUESTED_ROW, method: "natcash", status: "pending" },
    });

    await runRequestWithdrawal(supabase, { ...baseInput, method: "natcash" });

    expect(getPaymentProviderMock).toHaveBeenCalledWith("natcash_api");
  });
});
