/**
 * Unit tests for plop-provider.server.ts — the layer that decides what
 * PLOP's connector is and isn't allowed to do. Mirrors
 * moncash-provider.test.ts's structure; the equivalent central invariant
 * here is that `direction:"disburse"` must NEVER succeed (this
 * replacement is Collect-only by explicit mission scope — see
 * docs/PLOP_PHASE0_AUDIT.md § 8), and `verifyWebhook()` must ALWAYS
 * refuse (PLOP documents no webhook — docs/PLOP_PHASE0_AUDIT.md § 9).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

function setConfiguredEnv() {
  process.env.PLOP_CLIENT_ID = "test-client-id";
  process.env.PLOP_CLIENT_SECRET = "test-client-secret";
}

function clearPlopEnv() {
  delete process.env.PLOP_CLIENT_ID;
  delete process.env.PLOP_CLIENT_SECRET;
  delete process.env.PLOP_PAYMENT_METHOD;
}

describe("plopProvider — code identity", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  it("keeps code:'moncash_api' — the internal provider_code stays stable across the backend swap", async () => {
    const { plopProvider } = await import("../plop-provider.server");
    expect(plopProvider.code).toBe("moncash_api");
  });
});

describe("plopProvider.initiatePayment — disbursement must always be refused", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses direction:'disburse' even when fully configured", async () => {
    setConfiguredEnv();
    const { plopProvider } = await import("../plop-provider.server");

    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      counterpartyName: "Test Beneficiary",
      reference: "REF-1",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("unsupported");
  });

  it("refuses direction:'disburse' when NOT configured (not_configured wins first)", async () => {
    clearPlopEnv();
    const { plopProvider } = await import("../plop-provider.server");

    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      counterpartyName: null,
      reference: "REF-2",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("not_configured");
  });

  it("isConfigured() reflects real secret presence, not a hardcoded value", async () => {
    clearPlopEnv();
    const { plopProvider: notConfigured } = await import("../plop-provider.server");
    expect(notConfigured.isConfigured()).toBe(false);

    vi.resetModules();
    setConfiguredEnv();
    const { plopProvider: configured } = await import("../plop-provider.server");
    expect(configured.isConfigured()).toBe(true);
  });
});

describe("plopProvider.initiatePayment — direction:'collect'", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  it("returns 'pending' with the redirect URL on success — never 'success' immediately (PLOP has no synchronous confirmation)", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        createPayment: vi.fn(async () => ({
          redirectUrl: "https://redirect-paiement.example/xyz",
          providerTransactionId: "TX-1",
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-3",
    });

    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.providerReference).toBe("REF-3");
      expect((result.raw as { redirectUrl?: string })?.redirectUrl).toBe(
        "https://redirect-paiement.example/xyz",
      );
    }
  });

  it("reports failure (never a guessed success) when createPayment throws AND the reconciliation lookup also fails", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        createPayment: vi.fn(async () => {
          throw new actual.PlopApiError("simulated rejection");
        }),
        verifyPayment: vi.fn(async () => {
          throw new actual.PlopApiError("reconciliation lookup also failed");
        }),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-4",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toBe("simulated rejection");
  });

  it("A1 fix — reports 'success' when createPayment throws but reconciliation finds trans_status:'ok' (the request actually went through)", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        createPayment: vi.fn(async () => {
          throw new actual.PlopApiError("simulated timeout", undefined, undefined, "timeout");
        }),
        verifyPayment: vi.fn(async () => ({
          transStatus: "ok" as const,
          providerTransactionId: "TX-RECONCILED",
          amount: 250,
          raw: { trans_status: "ok" },
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-5",
    });

    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.providerReference).toBe("TX-RECONCILED");
  });

  it("A1 fix — reports 'pending' (never 'failed') when createPayment throws but reconciliation finds trans_status:'no' (PLOP has the reference, just still processing)", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        createPayment: vi.fn(async () => {
          throw new actual.PlopApiError("simulated timeout", undefined, undefined, "timeout");
        }),
        verifyPayment: vi.fn(async () => ({
          transStatus: "no" as const,
          providerTransactionId: null,
          amount: null,
          raw: {},
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-6",
    });

    expect(result.status).toBe("pending");
    if (result.status === "pending") expect(result.providerReference).toBe("REF-6");
  });
});

describe("plopProvider.checkStatus", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  it("maps trans_status 'ok' to status:'success'", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyPayment: vi.fn(async () => ({
          transStatus: "ok" as const,
          providerTransactionId: "TX-2",
          amount: 250,
          raw: {},
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-7");

    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.providerReference).toBe("TX-2");
  });

  it("maps trans_status 'no' to status:'pending'", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyPayment: vi.fn(async () => ({
          transStatus: "no" as const,
          providerTransactionId: null,
          amount: null,
          raw: {},
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-8");

    expect(result.status).toBe("pending");
  });

  it("maps an undocumented trans_status to status:'unknown', never a guessed success or failure", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyPayment: vi.fn(async () => ({
          transStatus: "unknown" as const,
          providerTransactionId: null,
          amount: null,
          raw: {},
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-9");

    expect(result.status).toBe("unknown");
  });

  it("A7 fix — maps a verifyPayment rejection (network/API failure) to status:'unknown', never lets the exception escape", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyPayment: vi.fn(async () => {
          throw new actual.PlopApiError("network error while checking status");
        }),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-10");

    expect(result.status).toBe("unknown");
    if (result.status === "unknown")
      expect(result.error).toBe("network error while checking status");
  });

  it("returns status:'unknown' without calling verifyPayment at all when not configured", async () => {
    clearPlopEnv();
    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-11");
    expect(result.status).toBe("unknown");
  });
});

describe("plopProvider.cancelPayment", () => {
  it("always reports not_cancellable — honest, no cancellation endpoint documented", async () => {
    vi.resetModules();
    setConfiguredEnv();
    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.cancelPayment("REF-12");
    expect(result.status).toBe("not_cancellable");
  });
});

describe("plopProvider.verifyWebhook", () => {
  it("always refuses — PLOP documents no webhook mechanism at all", async () => {
    vi.resetModules();
    setConfiguredEnv();
    const { plopProvider } = await import("../plop-provider.server");

    const result = await plopProvider.verifyWebhook("{}", {});

    expect(result.valid).toBe(false);
  });

  it("refuses even with a plausible-looking signature header — no scheme is fabricated", async () => {
    vi.resetModules();
    setConfiguredEnv();
    const { plopProvider } = await import("../plop-provider.server");

    const result = await plopProvider.verifyWebhook(JSON.stringify({ ok: true }), {
      "x-plop-signature": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result.valid).toBe(false);
  });
});
