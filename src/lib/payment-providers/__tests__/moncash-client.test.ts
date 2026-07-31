/**
 * Unit tests for the MonCash HTTP client — the layer that actually talks
 * to MonCash. Every test mocks `fetch` and the service-role Supabase
 * client (never a real network call, never a real database write); real
 * MonCash credentials don't exist anywhere in this project (see
 * docs/PAYMENT_PROVIDERS.md), so this is the only way any of this code
 * has ever been exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn(async (_row: unknown) => ({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

const API_URL = "https://sandbox.example.test/Api";

function setConfiguredEnv() {
  process.env.MONCASH_CLIENT_ID = "test-client-id";
  process.env.MONCASH_CLIENT_SECRET = "test-client-secret";
  process.env.MONCASH_MERCHANT_ID = "test-merchant-id";
  process.env.MONCASH_API_URL = API_URL;
  process.env.MONCASH_WEBHOOK_SECRET = "test-webhook-secret";
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

describe("moncash-client.server.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    setConfiguredEnv();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createPayment: happy path returns a payment token and redirect URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "secret-token-abc", expires_in: 3600 });
      }
      if (url.endsWith("/v1/CreatePayment")) {
        return jsonResponse(200, {
          payment_token: { token: "paytok-1234567890", expired: "2026-01-01T00:00:00Z" },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../moncash-client.server");
    const result = await createPayment("ORDER-1", 500);

    expect(result.paymentToken).toBe("paytok-1234567890");
    expect(result.redirectUrl).toContain(
      "Moncash-middleware/Payment/Redirect?token=paytok-1234567890",
    );
    expect(result.expiresAt).toBe("2026-01-01T00:00:00Z");
  });

  it("createPayment: never logs the Authorization header, client secret, or raw tokens", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "SUPER-SECRET-TOKEN", expires_in: 3600 });
      }
      return jsonResponse(200, { payment_token: { token: "paytok-abcdefghij", expired: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../moncash-client.server");
    await createPayment("ORDER-SECRET-TEST", 100);

    expect(insertMock).toHaveBeenCalled();
    const insertedRows = insertMock.mock.calls.map((call) => JSON.stringify(call[0]));
    for (const row of insertedRows) {
      expect(row).not.toContain("SUPER-SECRET-TOKEN");
      expect(row).not.toContain("test-client-secret");
      expect(row).not.toContain("Authorization");
      expect(row).not.toContain("Bearer");
      // The payment token must be truncated, never present in full.
      expect(row).not.toContain("paytok-abcdefghij");
    }
    // The token-redacted form (first4…last4) IS expected to appear once.
    const combined = insertedRows.join("\n");
    expect(combined).toContain("payt…ghij");
  });

  it("createPayment: a 4xx response is never retried", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(400, { message: "orderId already used" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, MonCashApiError } = await import("../moncash-client.server");
    await expect(createPayment("ORDER-DUP", 100)).rejects.toBeInstanceOf(MonCashApiError);

    const createPaymentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/v1/CreatePayment"),
    );
    expect(createPaymentCalls).toHaveLength(1);
  });

  it("createPayment: a timeout is retried up to 3 attempts and reported with code 'timeout'", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      throw abortError();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, MonCashApiError } = await import("../moncash-client.server");
    const error = await createPayment("ORDER-TIMEOUT", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MonCashApiError);
    expect((error as InstanceType<typeof MonCashApiError>).code).toBe("timeout");
    const createPaymentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/v1/CreatePayment"),
    );
    expect(createPaymentCalls).toHaveLength(3);
  }, 10_000);

  it("createPayment: a network error is retried but NOT flagged as timeout", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, MonCashApiError } = await import("../moncash-client.server");
    const error = await createPayment("ORDER-NETERR", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MonCashApiError);
    expect((error as InstanceType<typeof MonCashApiError>).code).toBeUndefined();
  }, 10_000);

  it("createPayment: retries a 500 and succeeds if a later attempt returns 200", async () => {
    let createPaymentAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      createPaymentAttempts += 1;
      if (createPaymentAttempts < 2) return jsonResponse(500, { message: "server error" });
      return jsonResponse(200, { payment_token: { token: "paytok-recovered12", expired: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../moncash-client.server");
    const result = await createPayment("ORDER-RETRY-OK", 100);

    expect(result.paymentToken).toBe("paytok-recovered12");
    expect(createPaymentAttempts).toBe(2);
  }, 10_000);

  it("createPayment: MonCash entirely unavailable (every attempt 503) fails cleanly after exactly 3 tries", async () => {
    let createPaymentAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      createPaymentAttempts += 1;
      return jsonResponse(503, { message: "Service unavailable" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, MonCashApiError } = await import("../moncash-client.server");
    const error = await createPayment("ORDER-DOWN", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MonCashApiError);
    expect(createPaymentAttempts).toBe(3);
  }, 10_000);

  it("createPayment: a 200 response with a malformed (non-JSON) body raises a clean MonCashApiError, not a raw SyntaxError", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return new Response("<html>502 Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, MonCashApiError } = await import("../moncash-client.server");
    const error = await createPayment("ORDER-BADBODY", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MonCashApiError);
    expect((error as Error).message).not.toMatch(/^Unexpected token|is not valid JSON/i);
  });

  it("retrieveOrderPayment: a 404 resolves to null, not an error", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { retrieveOrderPayment } = await import("../moncash-client.server");
    await expect(retrieveOrderPayment("ORDER-MISSING")).resolves.toBeNull();
  });

  it("retrieveOrderPayment: extracts the MonCash reference and status from the response", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, {
        transaction: {
          transaction_id: "MONCASH-REF-777",
          order_id: "ORDER-1",
          message: "successful",
          cost: 500,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { retrieveOrderPayment } = await import("../moncash-client.server");
    const tx = await retrieveOrderPayment("ORDER-1");

    expect(tx).not.toBeNull();
    expect(tx?.transactionId).toBe("MONCASH-REF-777");
    expect(tx?.status).toBe("successful");
    expect(tx?.amount).toBe(500);
  });

  it("getAccessToken: concurrent callers share a single in-flight token request", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        tokenRequests += 1;
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, {
        transaction: { transaction_id: "X", order_id: "Y", message: "pending" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { retrieveOrderPayment } = await import("../moncash-client.server");
    await Promise.all([
      retrieveOrderPayment("A"),
      retrieveOrderPayment("B"),
      retrieveOrderPayment("C"),
    ]);

    expect(tokenRequests).toBe(1);
  });
});
