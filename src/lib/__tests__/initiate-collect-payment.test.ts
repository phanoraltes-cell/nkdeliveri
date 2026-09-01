/**
 * Unit tests for runInitiateCollectPayment — the orchestration logic in
 * initiate-collect-payment.logic.ts (kept out of
 * initiate-collect-payment.functions.ts specifically so it's importable
 * here without dragging in TanStack Start's createServerFn runtime,
 * which hangs when imported outside a real request context).
 * plopProvider is mocked (Phase 3 wiring — see
 * docs/archive/plop/PLOP_PHASE3_WIRING_REPORT.md; previously moncashProvider); no
 * real network call, no real database write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitiatePaymentResult } from "../payment-providers/types";

const initiatePaymentMock = vi.fn<(input: unknown) => Promise<InitiatePaymentResult>>();
const isConfiguredMock = vi.fn(() => true);
vi.mock("../payment-providers/plop-provider.server", () => ({
  plopProvider: {
    isConfigured: () => isConfiguredMock(),
    initiatePayment: (input: unknown) => initiatePaymentMock(input),
  },
}));

// Separate mock fns from PLOP's own — a test disabling/misconfiguring one
// provider must never accidentally affect the other's mock state
// (docs/archive/audits/STRIPE_INTEGRATION_REPORT.md).
const stripeInitiatePaymentMock = vi.fn<(input: unknown) => Promise<InitiatePaymentResult>>();
const stripeIsConfiguredMock = vi.fn(() => true);
vi.mock("../payment-providers/stripe-provider.server", () => ({
  stripeProvider: {
    isConfigured: () => stripeIsConfiguredMock(),
    initiatePayment: (input: unknown) => stripeInitiatePaymentMock(input),
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
  {
    provider: "natcash_auto",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
  {
    provider: "stripe",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
];

function buildSupabaseMock(opts: {
  payment?: {
    id: string;
    method: string;
    status: string;
    amount: number;
    order_id?: string;
  } | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
  providerSettings?: ProviderSettingRow[];
}) {
  // `??` can't distinguish "not provided" from "explicitly null" (both
  // are nullish) -- and a test for "payment not found" needs exactly
  // that distinction, so check for the key's presence instead.
  const payment =
    "payment" in opts
      ? opts.payment
      : {
          id: "pay-1",
          method: "moncash",
          status: "awaiting_proof",
          amount: 500,
          order_id: "order-1",
        };
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
    stripeInitiatePaymentMock.mockReset();
    stripeIsConfiguredMock.mockReset();
    stripeIsConfiguredMock.mockReturnValue(true);
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
      expect.objectContaining({ direction: "collect", amount: 500, paymentMethod: "moncash" }),
    );
    // Dynamic wallet selection (docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 2)
    // — the order's own rail is recorded as payment_method_requested,
    // never left to plop-client.server.ts's global config default.
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_collect_payment_secure",
      expect.objectContaining({ _status: "pending", _payment_method_requested: "moncash" }),
    );
  });

  it("1b. paiement déjà confirmé (reconciliation-on-error, A1) — returns 'already_confirmed', never fabricates a redirect", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "success",
      providerReference: "TX-RECONCILED",
      raw: { trans_status: "ok" },
    });
    const supabase = buildSupabaseMock({
      rpcResult: { data: { id: "tx-already", status: "pending" }, error: null },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("already_confirmed");
    if (result.outcome === "already_confirmed") {
      expect(result.transaction).toEqual({ id: "tx-already", status: "pending" });
    }
    // Still recorded via create_collect_payment_secure with _status:'pending'
    // — complete_collect_payment_secure is service_role-only, this
    // customer-scoped call could never call it directly.
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_collect_payment_secure",
      expect.objectContaining({ _status: "pending" }),
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

  it("rejects a payment method that is neither MonCash nor NatCash (e.g. kach) without ever calling the provider", async () => {
    const supabase = buildSupabaseMock({
      payment: { id: "pay-2", method: "kach", status: "awaiting_proof", amount: 300 },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-2" });

    expect(result.outcome).toBe("failed");
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("accepts a NatCash payment (docs/archive/plop/PLOP_NATCASH_INTEGRATION_PLAN.md) — passes paymentMethod:'natcash' through and records it", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "REF-NATCASH-1",
      raw: { redirectUrl: "https://natcash.example/pay/abc" },
    });
    const supabase = buildSupabaseMock({
      payment: { id: "pay-3", method: "natcash", status: "awaiting_proof", amount: 400 },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-3" });

    expect(result.outcome).toBe("pending");
    expect(initiatePaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "collect", amount: 400, paymentMethod: "natcash" }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_collect_payment_secure",
      expect.objectContaining({ _status: "pending", _payment_method_requested: "natcash" }),
    );
  });

  it("accepts a Kat Kredi (Stripe) payment (docs/archive/audits/STRIPE_INTEGRATION_REPORT.md) — dispatches to stripeProvider, not plopProvider, passes a real returnUrl, and stores providerReference as _provider_transaction_id", async () => {
    stripeInitiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "cs_test_ABC123",
      raw: { redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_ABC123" },
    });
    const supabase = buildSupabaseMock({
      payment: {
        id: "pay-4",
        method: "stripe",
        status: "awaiting_proof",
        amount: 750,
        order_id: "order-4",
      },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-4" });

    expect(result.outcome).toBe("pending");
    if (result.outcome === "pending") {
      expect(result.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_ABC123");
    }
    // Never called the PLOP mock — a Stripe payment must dispatch to
    // stripeProvider exclusively.
    expect(initiatePaymentMock).not.toHaveBeenCalled();
    expect(stripeInitiatePaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "collect",
        amount: 750,
        paymentMethod: "stripe",
        returnUrl: "https://www.nkdeliveri.com/orders/order-4",
      }),
    );
    // The Stripe Checkout Session id (providerReference) must be
    // persisted immediately — it's the only way checkStatus()/the poll
    // can look this transaction up later (stripe-provider.server.ts's
    // own header comment: Stripe has no lookup-by-reference endpoint).
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_collect_payment_secure",
      expect.objectContaining({
        _status: "pending",
        _payment_method_requested: "stripe",
        _provider_transaction_id: "cs_test_ABC123",
      }),
    );
  });

  it("refuses a Stripe payment when stripe is disabled, with a Kat Kredi-specific message", async () => {
    const supabase = buildSupabaseMock({
      payment: {
        id: "pay-1",
        method: "stripe",
        status: "awaiting_proof",
        amount: 250,
        order_id: "order-1",
      },
      providerSettings: [
        ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "stripe"),
        {
          provider: "stripe",
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
      expect(result.error).toBe("Kat Kredi pa disponib pou kounye a.");
    }
    expect(stripeInitiatePaymentMock).not.toHaveBeenCalled();
  });

  it("disabling stripe never blocks a MonCash payment, and disabling moncash_auto never blocks a Stripe payment — all three automatic methods are independently gated", async () => {
    initiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "REF-MONCASH-INDEP",
      raw: { redirectUrl: "https://moncash.example/pay/xyz" },
    });
    const supabaseMoncashWithStripeDisabled = buildSupabaseMock({
      payment: {
        id: "pay-1",
        method: "moncash",
        status: "awaiting_proof",
        amount: 250,
        order_id: "order-1",
      },
      providerSettings: [
        ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "stripe"),
        {
          provider: "stripe",
          visible: true,
          enabled: false,
          default_provider: false,
          maintenance_message: null,
        },
      ],
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");
    const moncashResult = await runInitiateCollectPayment(supabaseMoncashWithStripeDisabled, {
      paymentId: "pay-1",
    });
    expect(moncashResult.outcome).toBe("pending");

    stripeInitiatePaymentMock.mockResolvedValue({
      status: "pending",
      providerReference: "cs_test_INDEP",
      raw: { redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_INDEP" },
    });
    const supabaseStripeWithMoncashDisabled = buildSupabaseMock({
      payment: {
        id: "pay-1",
        method: "stripe",
        status: "awaiting_proof",
        amount: 250,
        order_id: "order-1",
      },
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
    const stripeResult = await runInitiateCollectPayment(supabaseStripeWithMoncashDisabled, {
      paymentId: "pay-1",
    });
    expect(stripeResult.outcome).toBe("pending");
  });

  it("refuses to call an unconfigured provider", async () => {
    isConfiguredMock.mockReturnValue(false);
    const supabase = buildSupabaseMock({});
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("failed");
    expect(initiatePaymentMock).not.toHaveBeenCalled();
  });

  it("refuses to call an unconfigured Stripe provider, independently of PLOP's own isConfigured() state", async () => {
    stripeIsConfiguredMock.mockReturnValue(false);
    const supabase = buildSupabaseMock({
      payment: {
        id: "pay-1",
        method: "stripe",
        status: "awaiting_proof",
        amount: 250,
        order_id: "order-1",
      },
    });
    const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

    const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

    expect(result.outcome).toBe("failed");
    expect(stripeInitiatePaymentMock).not.toHaveBeenCalled();
    // PLOP's own isConfigured() mock was never touched by this test — it
    // must not be asked at all when the payment is a Stripe one.
    expect(isConfiguredMock).not.toHaveBeenCalled();
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
            maintenance_message: "MonCash Otomatik ap retounen byento.",
          },
        ],
      });
      const { runInitiateCollectPayment } = await import("../initiate-collect-payment.logic");

      const result = await runInitiateCollectPayment(supabase, { paymentId: "pay-1" });

      expect(result).toEqual({
        outcome: "failed",
        error: "MonCash Otomatik ap retounen byento.",
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
          _error: "MonCash Otomatik ap retounen byento.",
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
        expect(result.error).toBe("MonCash Otomatik pa disponib pou kounye a.");
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

    it("refuses a NatCash payment when natcash_auto is disabled, with a NatCash-specific message", async () => {
      const supabase = buildSupabaseMock({
        payment: { id: "pay-1", method: "natcash", status: "awaiting_proof", amount: 250 },
        providerSettings: [
          ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "natcash_auto"),
          {
            provider: "natcash_auto",
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
        expect(result.error).toBe("NatCash Otomatik pa disponib pou kounye a.");
      }
      expect(initiatePaymentMock).not.toHaveBeenCalled();
    });

    it("disabling moncash_auto never blocks a NatCash payment, and disabling natcash_auto never blocks a MonCash payment — the two checkout methods are independently gated (docs/archive/plop/PLOP_NATCASH_INTEGRATION_PLAN.md § 2.5, the bug this migration fixes)", async () => {
      initiatePaymentMock.mockResolvedValue({
        status: "pending",
        providerReference: "REF-INDEPENDENT",
        raw: { redirectUrl: "https://natcash.example/pay/xyz" },
      });
      // moncash_auto disabled, natcash_auto still enabled — a NatCash
      // payment must still go through.
      const supabaseNatcash = buildSupabaseMock({
        payment: { id: "pay-1", method: "natcash", status: "awaiting_proof", amount: 250 },
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
      const natcashResult = await runInitiateCollectPayment(supabaseNatcash, {
        paymentId: "pay-1",
      });
      expect(natcashResult.outcome).toBe("pending");

      // The reverse: natcash_auto disabled, moncash_auto still enabled —
      // a MonCash payment must still go through.
      initiatePaymentMock.mockClear();
      initiatePaymentMock.mockResolvedValue({
        status: "pending",
        providerReference: "REF-INDEPENDENT-2",
        raw: { redirectUrl: "https://moncash.example/pay/xyz" },
      });
      const supabaseMoncash = buildSupabaseMock({
        payment: { id: "pay-1", method: "moncash", status: "awaiting_proof", amount: 250 },
        providerSettings: [
          ...DEFAULT_PROVIDER_SETTINGS.filter((s) => s.provider !== "natcash_auto"),
          {
            provider: "natcash_auto",
            visible: true,
            enabled: false,
            default_provider: false,
            maintenance_message: null,
          },
        ],
      });
      const moncashResult = await runInitiateCollectPayment(supabaseMoncash, {
        paymentId: "pay-1",
      });
      expect(moncashResult.outcome).toBe("pending");
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
