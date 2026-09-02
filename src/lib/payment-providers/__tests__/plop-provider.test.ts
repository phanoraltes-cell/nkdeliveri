/**
 * Unit tests for plop-provider.server.ts — the layer that decides what
 * PLOP's connector is and isn't allowed to do. Mirrors
 * moncash-provider.test.ts's structure. `verifyWebhook()` must ALWAYS
 * refuse (PLOP documents no webhook — docs/archive/plop/PLOP_PHASE0_AUDIT.md § 9).
 *
 * Tach 3 (PROMPT MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) — `direction:
 * "disburse"` is now a REAL implementation (PLOP's Withdrawal API,
 * executeWithdrawal()/verifyWithdrawal() in plop-client.server.ts), on
 * Altes's explicit go-ahead. The old invariant here ("disbursement must
 * always be refused") is gone; these tests instead cover success,
 * PLOP-side rejection mapping, and the "never guess failed on a
 * network/timeout error" rule (the withdrawal-token is single-use, so a
 * retry is impossible and money may have already moved).
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

describe("plopProvider.initiatePayment — direction:'disburse' (Tach 3, PLOP Withdrawal API)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses direction:'disburse' when NOT configured (not_configured wins first, never calls executeWithdrawal)", async () => {
    clearPlopEnv();
    const executeWithdrawalMock = vi.fn();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, executeWithdrawal: executeWithdrawalMock };
    });

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
    expect(executeWithdrawalMock).not.toHaveBeenCalled();
  });

  it("rejects a missing counterpartyNumber before ever calling PLOP (caller-side bug, not a PLOP outcome)", async () => {
    setConfiguredEnv();
    const executeWithdrawalMock = vi.fn();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, executeWithdrawal: executeWithdrawalMock };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      reference: "REF-NO-RECIPIENT",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("rejected");
    expect(executeWithdrawalMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized paymentMethod with code:'invalid_wallet' without calling PLOP", async () => {
    setConfiguredEnv();
    const executeWithdrawalMock = vi.fn();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, executeWithdrawal: executeWithdrawalMock };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      paymentMethod: "bogus-wallet",
      reference: "REF-BAD-WALLET",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("invalid_wallet");
    expect(executeWithdrawalMock).not.toHaveBeenCalled();
  });

  it("returns status:'success' with PLOP's transaction id when the withdrawal succeeds", async () => {
    setConfiguredEnv();
    const executeWithdrawalMock = vi.fn(async () => ({
      status: "success" as const,
      providerTransactionId: "WD-TX-1",
      errorCode: null,
      message: null,
      raw: { status: true, transaction_id: "WD-TX-1" },
    }));
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, executeWithdrawal: executeWithdrawalMock };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      counterpartyName: "Test Beneficiary",
      reference: "REF-1",
    });

    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.providerReference).toBe("WD-TX-1");
    expect(executeWithdrawalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        method: "moncash",
        recipient: "+50912345678",
        reference: "REF-1",
      }),
    );
  });

  it("maps PLOP's INSUFFICIENT_BALANCE rejection to status:'failed', code:'rejected'", async () => {
    setConfiguredEnv();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        executeWithdrawal: vi.fn(async () => ({
          status: "failed" as const,
          providerTransactionId: null,
          errorCode: "INSUFFICIENT_BALANCE" as const,
          message: "Balans machann lan pa sifi",
          raw: { status: false, error_code: "INSUFFICIENT_BALANCE" },
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      reference: "REF-INSUFFICIENT",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("rejected");
  });

  it("maps PLOP's METHOD_NOT_CONFIGURED rejection to code:'invalid_wallet' specifically", async () => {
    setConfiguredEnv();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        executeWithdrawal: vi.fn(async () => ({
          status: "failed" as const,
          providerTransactionId: null,
          errorCode: "METHOD_NOT_CONFIGURED" as const,
          message: "Metòd sa a pa konfigire",
          raw: { status: false, error_code: "METHOD_NOT_CONFIGURED" },
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      paymentMethod: "natcash",
      reference: "REF-NOT-CONFIGURED",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("invalid_wallet");
  });

  it("reports status:'pending' (never 'failed') when executeWithdrawal throws a timeout — the withdrawal-token is single-use so this attempt can never be safely retried", async () => {
    setConfiguredEnv();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        executeWithdrawal: vi.fn(async () => {
          throw new actual.PlopApiError("simulated timeout", undefined, undefined, "timeout");
        }),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      reference: "REF-TIMEOUT",
    });

    expect(result.status).toBe("pending");
    if (result.status === "pending") expect(result.providerReference).toBe("REF-TIMEOUT");
  });

  it("reports status:'failed' (not 'pending') when executeWithdrawal throws a non-timeout error", async () => {
    setConfiguredEnv();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        executeWithdrawal: vi.fn(async () => {
          throw new actual.PlopApiError("simulated auth failure");
        }),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "disburse",
      amount: 500,
      counterpartyNumber: "+50912345678",
      reference: "REF-AUTH-FAIL",
    });

    expect(result.status).toBe("failed");
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

describe("plopProvider.checkStatus — direction:'disburse' (PLOP Withdrawal verify)", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  it("maps a withdrawal verify status of 'success' to status:'success'", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyWithdrawal: vi.fn(async () => ({ status: "success" as const, raw: {} })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-W1", "disburse");

    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.providerReference).toBe("REF-W1");
  });

  it("maps a withdrawal verify status of 'failed' to status:'failed'", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyWithdrawal: vi.fn(async () => ({ status: "failed" as const, raw: {} })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-W2", "disburse");

    expect(result.status).toBe("failed");
  });

  it("maps a withdrawal verify status of 'pending' to status:'pending'", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyWithdrawal: vi.fn(async () => ({ status: "pending" as const, raw: {} })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-W3", "disburse");

    expect(result.status).toBe("pending");
  });

  it("maps 'refunded' and other non-terminal statuses to status:'unknown', never a guessed success/failure", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyWithdrawal: vi.fn(async () => ({ status: "refunded" as const, raw: {} })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-W4", "disburse");

    expect(result.status).toBe("unknown");
  });

  it("maps a verifyWithdrawal rejection (network/API failure) to status:'unknown', never lets the exception escape", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyWithdrawal: vi.fn(async () => {
          throw new actual.PlopApiError("network error while verifying withdrawal");
        }),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-W5", "disburse");

    expect(result.status).toBe("unknown");
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
          walletUsed: null,
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

  it("dynamic wallet selection — passes input.paymentMethod through to createPayment (bug fix, docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 2)", async () => {
    const createPaymentMock = vi.fn(async () => ({
      redirectUrl: "https://redirect-paiement.example/natcash",
      providerTransactionId: "TX-NC",
      paymentMethodRequested: "natcash" as const,
    }));
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, createPayment: createPaymentMock };
    });

    const { plopProvider } = await import("../plop-provider.server");
    await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-NC",
      paymentMethod: "natcash",
    });

    expect(createPaymentMock).toHaveBeenCalledWith("REF-NC", 250, "natcash");
  });

  it("invalid wallet — rejected immediately with code:'invalid_wallet', never calls createPayment or attempts reconciliation", async () => {
    const createPaymentMock = vi.fn();
    const verifyPaymentMock = vi.fn();
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return { ...actual, createPayment: createPaymentMock, verifyPayment: verifyPaymentMock };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.initiatePayment({
      direction: "collect",
      amount: 250,
      reference: "REF-BAD",
      paymentMethod: "bogus-wallet",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("invalid_wallet");
    expect(createPaymentMock).not.toHaveBeenCalled();
    expect(verifyPaymentMock).not.toHaveBeenCalled();
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
          walletUsed: null,
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

  it("maps trans_status 'ok' to status:'success', carrying walletUsed through", async () => {
    vi.doMock("../plop-client.server", async () => {
      const actual =
        await vi.importActual<typeof import("../plop-client.server")>("../plop-client.server");
      return {
        ...actual,
        verifyPayment: vi.fn(async () => ({
          transStatus: "ok" as const,
          providerTransactionId: "TX-2",
          amount: 250,
          walletUsed: "natcash",
          raw: {},
        })),
      };
    });

    const { plopProvider } = await import("../plop-provider.server");
    const result = await plopProvider.checkStatus("REF-7");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.providerReference).toBe("TX-2");
      expect(result.walletUsed).toBe("natcash");
    }
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
          walletUsed: null,
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
          walletUsed: null,
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
