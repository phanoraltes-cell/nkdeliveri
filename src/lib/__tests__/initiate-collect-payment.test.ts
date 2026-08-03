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

type ProviderSettingRow = {
  provider: string;
  visible: boolean;
  enabled: boolean;
  default_provider: boolean;
  maintenance_message: string | null;
};

const DEFAULT_PROVIDER_SETTINGS: ProviderSettingRow[] = [
  {
    provider: "kach",
    visible: true,
    enabled: true,
    default_provider: true,
    maintenance_message: null,
  },
  {
    provider: "moncash",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
  {
    provider: "moncash_auto",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
  {
    provider: "natcash",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
];

function buildSupabaseMock(opts: {
  payment?: { id: string; method: string; status: string; amount: number } | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
  providerSettings?: ProviderSettingRow[];
}) {
  // `??` can't distinguish "not provided" from "explicitly null" (both
  // are nullish) -- and a test for "payment not found" needs exactly
  // that distinction, so check for the key's presence instead.
  const payment =
    "payment" in opts
      ? opts.payment
      : { id: "pay-1", method: "moncash", status: "awaiting_proof", amount: 500 };
  const rpcResult = opts.rpcResult ?? { data: { id: "tx-1", status: "pending" }, error: null };
  const providerSettings = opts.providerSettings ?? DEFAULT_PROVIDER_SETTINGS;

  const rpc = vi.fn(async () => rpcResult);
  const from = vi.fn((table: string) => {
    if (table === "payment_provider_settings") {
      return {
        select: () => ({
          order: async () => ({ data: providerSettings, error: null }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: payment, error: null }),
        }),
      }),
    };
  });
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

  describe("payment_provider_settings hardening (backend is the sole source of truth)", () => {
    it("refuses when moncash_auto is disabled — never checks isConfigured(), never imports the provider, but still logs the attempt", async () => {
      const supabase = buildSupabaseMock({
        providerSettings: [
          ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "moncash_auto"),
          {
            provider: "moncash_auto",
            visible: true,
            enabled: false,
            default_provider: false,
            maintenance_message: "MonCash Automatik ap retounen byento.",
          },
        ],
      });
      const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

      const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

      expect(result).toEqual({
        outcome: "failed",
        error: "MonCash Automatik ap retounen byento.",
      });
      // The real point of this test: isConfigured() is never even asked,
      // and the provider is never called — a disabled setting short-
      // circuits before either, exactly like the mission's "ne jamais
      // appeler l'API MonCash" requirement.
      expect(isConfiguredMock).not.toHaveBeenCalled();
      expect(initiatePaymentMock).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledWith(
        "create_collect_payment_secure",
        expect.objectContaining({
          _status: "failed",
          _error: "MonCash Automatik ap retounen byento.",
        }),
      );
    });

    it("falls back to a generic message when disabled without a maintenance_message set", async () => {
      const supabase = buildSupabaseMock({
        providerSettings: [
          ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "moncash_auto"),
          {
            provider: "moncash_auto",
            visible: true,
            enabled: false,
            default_provider: false,
            maintenance_message: null,
          },
        ],
      });
      const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

      const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") {
        expect(result.error).toBe("MonCash Automatik pa disponib pou kounye a.");
      }
    });

    it("proceeds to isConfigured()/the provider once enabled is true (no regression from the new gate)", async () => {
      initiatePaymentMock.mockResolvedValue({
        status: "pending",
        providerReference: "REF-6",
        raw: { redirectUrl: "https://moncash.example/pay/jkl" },
      });
      const supabase = buildSupabaseMock({});
      const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

      const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

      expect(result.outcome).toBe("pending");
      expect(isConfiguredMock).toHaveBeenCalled();
      expect(initiatePaymentMock).toHaveBeenCalledTimes(1);
    });

    it("attackers cannot bypass the gate by any client-supplied input — the check reads only from the database, never from InitiateCollectPaymentInput", async () => {
      // InitiateCollectPaymentInputSchema only ever accepts { paymentId }
      // (see the zod schema at the top of initiate-collect-payment.logic.ts)
      // — there is no field an attacker could set to claim "enabled: true".
      // This test documents that guarantee structurally rather than
      // asserting a negative that's easy to phrase but not actually verify.
      const { InitiateCollectPaymentInputSchema } =
        await import("../initiate-collect-payment.logic");
      const parsed = InitiateCollectPaymentInputSchema.safeParse({
        paymentId: "11111111-1111-1111-1111-111111111111",
        enabled: true,
        providerAvailable: true,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(Object.keys(parsed.data)).toEqual(["paymentId"]);
      }
    });
  });
});
