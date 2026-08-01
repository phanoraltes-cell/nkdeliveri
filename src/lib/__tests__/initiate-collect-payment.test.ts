/**
 * Unit tests for runInitiateCollectPayment — the orchestration logic in
 * initiate-collect-payment.logic.ts (kept out of
 * initiate-collect-payment.functions.ts specifically so it's importable
 * here without dragging in TanStack Start's createServerFn runtime,
 * which hangs when imported outside a real request context).
 * moncashProvider is mocked; no real network call, no real database
 * write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitiatePaymentResult } from "../payment-providers/types";

const initiatePaymentMock = vi.fn<(input: unknown) => Promise<InitiatePaymentResult>>();
const isConfiguredMock = vi.fn(() => true);
vi.mock("../payment-providers/moncash-provider.server", () => ({
  moncashProvider: {
    isConfigured: () => isConfiguredMock(),
    initiatePayment: (input: unknown) => initiatePaymentMock(input),
  },
}));

function buildSupabaseMock(opts: {
  payment?: { id: string; method: string; status: string; amount: number } | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  // `??` can't distinguish "not provided" from "explicitly null" (both
  // are nullish) -- and a test for "payment not found" needs exactly
  // that distinction, so check for the key's presence instead.
  const payment =
    "payment" in opts
      ? opts.payment
      : { id: "pay-1", method: "moncash", status: "awaiting_proof", amount: 500 };
  const rpcResult = opts.rpcResult ?? { data: { id: "tx-1", status: "pending" }, error: null };

  const rpc = vi.fn(async () => rpcResult);
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: payment, error: null }),
      }),
    }),
  }));
  return { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("runInitiateCollectPayment", () => {
  beforeEach(() => {
    vi.resetModules();
    initiatePaymentMock.mockReset();
    isConfiguredMock.mockReset();
    isConfiguredMock.mockReturnValue(true);
  });

  it("1. paiement créé correctement — returns pending with the redirect URL", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "REF-1",
      raw: { redirectUrl: "https://moncash.example/pay/abc" },
    });
    const supabase = buildSupabaseMock({});
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("pending");
    if (result.outcome === "pending") {
      expect(result.redirectUrl).toBe("https://moncash.example/pay/abc");
    }
    expect(initiatePaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "collect", amount: 500 }),
    );
  });

  it("2. erreur API MonCash — a provider rejection is reported and recorded, never thrown as a raw error", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "failed",
      error: "MonCash rejte demand lan",
      code: "rejected",
    });
    const supabase = buildSupabaseMock({
      rpcResult: { data: { id: "tx-2", status: "failed" }, error: null },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result).toEqual({ outcome: "failed", error: "MonCash rejte demand lan" });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_collect_payment_secure",
      expect.objectContaining({ _status: "failed", _error: "MonCash rejte demand lan" }),
    );
  });

  it("3. timeout — a timeout failure is reported the same honest way as any other rejection", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "failed",
      error: "MonCash pa reponn apre 15000ms (3 eseye)",
      code: "timeout",
    });
    const supabase = buildSupabaseMock({});

    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");
    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toMatch(/pa reponn/);
    }
  });

  it("4. retry — calls the provider exactly once per invocation, never retries client-side (retry is the connector's own job, already covered elsewhere)", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "REF-4",
      raw: { redirectUrl: "https://moncash.example/pay/def" },
    });
    const supabase = buildSupabaseMock({});

    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");
    await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(initiatePaymentMock).toHaveBeenCalledTimes(1);
  });

  it("5. absence de secret exposé — the returned object never carries the provider's raw response or config", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "REF-5",
      raw: {
        redirectUrl: "https://moncash.example/pay/ghi",
        paymentToken: "tok-secret-should-not-leak",
      },
    });
    const supabase = buildSupabaseMock({});

    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");
    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("tok-secret-should-not-leak");
    expect(Object.keys(result).sort()).toEqual(["outcome", "redirectUrl", "transaction"].sort());
  });

  it("rejects a payment that isn't found", async () => {
    const supabase = buildSupabaseMock({ payment: null });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "does-not-exist" });

    expect(result).toEqual({ outcome: "failed", error: "Peman pa jwenn" });
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("rejects a non-MonCash payment (e.g. natcash) without ever calling the provider", async () => {
    const supabase = buildSupabaseMock({
      payment: { id: "pay-2", method: "natcash", status: "awaiting_proof", amount: 300 },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-2" });

    expect(result.outcome).toBe("failed");
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("refuses to call an unconfigured provider", async () => {
    isConfiguredMock.mockReturnValue(false);
    const supabase = buildSupabaseMock({});
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("failed");
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });
});
