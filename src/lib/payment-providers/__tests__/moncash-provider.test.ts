/**
 * Unit tests for moncash-provider.server.ts — the layer that decides
 * what MonCash's connector is and isn't allowed to do. The single most
 * important invariant in this whole integration lives here:
 * direction:"disburse" must NEVER succeed, because MonCash's public API
 * has no B2C disbursement endpoint (see docs/PAYMENT_PROVIDERS.md).
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setConfiguredEnv() {
  process.env.MONCASH_CLIENT_ID = "test-client-id";
  process.env.MONCASH_CLIENT_SECRET = "test-client-secret";
  process.env.MONCASH_MERCHANT_ID = "test-merchant-id";
  process.env.MONCASH_API_URL = "https://sandbox.example.test/Api";
  process.env.MONCASH_WEBHOOK_SECRET = "test-webhook-secret";
}

function clearMonCashEnv() {
  delete process.env.MONCASH_CLIENT_ID;
  delete process.env.MONCASH_CLIENT_SECRET;
  delete process.env.MONCASH_MERCHANT_ID;
  delete process.env.MONCASH_API_URL;
  delete process.env.MONCASH_WEBHOOK_SECRET;
}

describe("moncashProvider.initiatePayment — disbursement must always be refused", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses direction:'disburse' even when fully configured", async () => {
    setConfiguredEnv();
    const { moncashProvider } = await import("../moncash-provider.server");

    const result = await moncashProvider.initiatePayment({
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
    clearMonCashEnv();
    const { moncashProvider } = await import("../moncash-provider.server");

    const result = await moncashProvider.initiatePayment({
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
    clearMonCashEnv();
    const { moncashProvider: notConfigured } = await import("../moncash-provider.server");
    expect(notConfigured.isConfigured()).toBe(false);

    vi.resetModules();
    setConfiguredEnv();
    const { moncashProvider: configured } = await import("../moncash-provider.server");
    expect(configured.isConfigured()).toBe(true);
  });
});

describe("moncashProvider.initiatePayment — direction:'collect' idempotent reconciliation", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  it("reports success if createPayment throws but the order actually succeeded on MonCash's side", async () => {
    vi.doMock("../moncash-client.server", async () => {
      const actual = await vi.importActual<typeof import("../moncash-client.server")>(
        "../moncash-client.server",
      );
      return {
        ...actual,
        createPayment: vi.fn(async () => {
          throw new actual.MonCashApiError("simulated timeout", undefined, undefined, "timeout");
        }),
        retrieveOrderPayment: vi.fn(async () => ({
          transactionId: "MONCASH-TX-1",
          orderId: "REF-3",
          status: "successful" as const,
          amount: 500,
          message: "successful",
          raw: {},
        })),
      };
    });

    const { moncashProvider } = await import("../moncash-provider.server");
    const result = await moncashProvider.initiatePayment({
      direction: "collect",
      amount: 500,
      counterpartyNumber: "+50912345678",
      counterpartyName: null,
      reference: "REF-3",
    });

    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.providerReference).toBe("MONCASH-TX-1");
  });

  it("reports failure (never success) if createPayment throws and reconciliation finds nothing", async () => {
    vi.doMock("../moncash-client.server", async () => {
      const actual = await vi.importActual<typeof import("../moncash-client.server")>(
        "../moncash-client.server",
      );
      return {
        ...actual,
        createPayment: vi.fn(async () => {
          throw new actual.MonCashApiError("simulated rejection");
        }),
        retrieveOrderPayment: vi.fn(async () => null),
      };
    });

    const { moncashProvider } = await import("../moncash-provider.server");
    const result = await moncashProvider.initiatePayment({
      direction: "collect",
      amount: 500,
      counterpartyNumber: "+50912345678",
      counterpartyName: null,
      reference: "REF-4",
    });

    expect(result.status).toBe("failed");
  });
});

describe("moncashProvider.verifyWebhook", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
  });

  afterEach(() => {
    clearMonCashEnv();
  });

  function sign(rawBody: string, secret: string): string {
    return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  }

  it("accepts a correctly signed payload and parses it into a normalized event", async () => {
    const { moncashProvider } = await import("../moncash-provider.server");
    const rawBody = JSON.stringify({
      transaction_id: "MONCASH-TX-5",
      order_id: "REF-5",
      message: "successful",
      amount: 250,
    });
    const signature = sign(rawBody, "test-webhook-secret");

    const result = await moncashProvider.verifyWebhook(rawBody, {
      "x-moncash-signature": signature,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.providerReference).toBe("MONCASH-TX-5");
      expect(result.event.ourReference).toBe("REF-5");
      expect(result.event.status).toBe("success");
    }
  });

  it("rejects a payload with an invalid signature", async () => {
    const { moncashProvider } = await import("../moncash-provider.server");
    const rawBody = JSON.stringify({ transaction_id: "X", order_id: "Y", message: "successful" });

    const result = await moncashProvider.verifyWebhook(rawBody, {
      "x-moncash-signature": "0000000000000000000000000000000000000000000000000000000000000000",
    });

    expect(result.valid).toBe(false);
  });

  it("rejects a tampered body even if a signature header is present", async () => {
    const { moncashProvider } = await import("../moncash-provider.server");
    const originalBody = JSON.stringify({
      transaction_id: "X",
      order_id: "Y",
      message: "successful",
    });
    const signature = sign(originalBody, "test-webhook-secret");
    const tamperedBody = JSON.stringify({ transaction_id: "X", order_id: "Y", message: "failed" });

    const result = await moncashProvider.verifyWebhook(tamperedBody, {
      "x-moncash-signature": signature,
    });

    expect(result.valid).toBe(false);
  });

  it("rejects when no secret is configured, without ever computing a comparison", async () => {
    clearMonCashEnv();
    const { moncashProvider } = await import("../moncash-provider.server");

    const result = await moncashProvider.verifyWebhook("{}", { "x-moncash-signature": "anything" });

    expect(result.valid).toBe(false);
  });
});
