/**
 * Unit tests for the PLOP HTTP client — the layer that actually talks to
 * PLOP's Collect API. Every test mocks `fetch` and the service-role
 * Supabase client (never a real network call, never a real database
 * write); real PLOP credentials don't exist anywhere in this project
 * (see docs/PLOP_PHASE0_AUDIT.md), so this is the only way any of this
 * code has ever been exercised. Mirrors moncash-client.test.ts's
 * structure — see that file's own header for why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn(async (_row: unknown) => ({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

function setConfiguredEnv() {
  process.env.PLOP_CLIENT_ID = "test-client-id-1234567890";
  process.env.PLOP_CLIENT_SECRET = "test-client-secret";
  delete process.env.PLOP_PAYMENT_METHOD;
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

describe("plop-client.server.ts", () => {
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

  it("createPayment: happy path returns a redirect URL and provider transaction id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://plopplop.solutionip.app/api/paiement-marchand");
      return jsonResponse(200, {
        status: true,
        message: "success",
        url: "https://redirect-paiement.example/abc",
        transaction_id: "173763124912345",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    const result = await createPayment("CMD-1", 250);

    expect(result.redirectUrl).toBe("https://redirect-paiement.example/abc");
    expect(result.providerTransactionId).toBe("173763124912345");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("createPayment: sends client_id/refference_id/montant/payment_method, defaulting payment_method to 'moncash'", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
        client_id: "test-client-id-1234567890",
        refference_id: "CMD-2",
        montant: 500,
        payment_method: "moncash",
      });
      return jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    await createPayment("CMD-2", 500);
  });

  it("createPayment: dynamic wallet selection — an explicit 'natcash' overrides the global config default (bug fix, docs/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 2)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.payment_method).toBe("natcash");
      return jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "NC-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    const result = await createPayment("CMD-NATCASH", 500, "natcash");

    expect(result.paymentMethodRequested).toBe("natcash");
  });

  it("createPayment: an explicit 'moncash' still works exactly like before (no regression)", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.payment_method).toBe("moncash");
      return jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "MC-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    const result = await createPayment("CMD-MONCASH", 500, "moncash");

    expect(result.paymentMethodRequested).toBe("moncash");
  });

  it("createPayment: an unrecognized wallet is rejected before any network call (invalid wallet)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    await expect(createPayment("CMD-BADWALLET", 100, "bogus-wallet")).rejects.toBeInstanceOf(
      PlopApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createPayment: never logs the full client_id, only a redacted form", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    await createPayment("CMD-SECRET-TEST", 100);

    expect(insertMock).toHaveBeenCalled();
    const insertedRows = insertMock.mock.calls.map((call) => JSON.stringify(call[0]));
    for (const row of insertedRows) {
      expect(row).not.toContain("test-client-id-1234567890");
    }
    const combined = insertedRows.join("\n");
    expect(combined).toContain("test…7890");
  });

  it("A5 fix — never logs PLOP_CLIENT_SECRET, even though it is a required config value", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, verifyPayment } = await import("../plop-client.server");
    await createPayment("CMD-SECRET-CHECK-1", 100);
    await verifyPayment("CMD-SECRET-CHECK-1");

    expect(insertMock).toHaveBeenCalled();
    const insertedRows = insertMock.mock.calls.map((call) => JSON.stringify(call[0]));
    for (const row of insertedRows) {
      expect(row).not.toContain("test-client-secret");
    }
  });

  it("createPayment: a 4xx response is never retried", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, { status: false, message: "Client introuvable" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    await expect(createPayment("CMD-DUP", 100)).rejects.toBeInstanceOf(PlopApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("createPayment: a timeout is retried up to 3 attempts and reported with code 'timeout'", async () => {
    const fetchMock = vi.fn(async () => {
      throw abortError();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    const error = await createPayment("CMD-TIMEOUT", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlopApiError);
    expect((error as InstanceType<typeof PlopApiError>).code).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("createPayment: a network error is retried but NOT flagged as timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    const error = await createPayment("CMD-NETERR", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlopApiError);
    expect((error as InstanceType<typeof PlopApiError>).code).toBeUndefined();
  }, 10_000);

  it("createPayment: retries a 503 and succeeds if a later attempt returns 200", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) return jsonResponse(503, { status: false, message: "Erreur interne" });
      return jsonResponse(200, { status: true, url: "https://x.test", transaction_id: "OK-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment } = await import("../plop-client.server");
    const result = await createPayment("CMD-RETRY-OK", 100);

    expect(result.providerTransactionId).toBe("OK-1");
    expect(attempts).toBe(2);
  }, 10_000);

  it("createPayment: PLOP entirely unavailable (every attempt 503) fails cleanly after exactly 3 tries", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      return jsonResponse(503, { status: false, message: "Erreur interne" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    const error = await createPayment("CMD-DOWN", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlopApiError);
    expect(attempts).toBe(3);
  }, 10_000);

  it("createPayment: a 200 response with status:true but no url raises a clean PlopApiError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: true, message: "success" }));
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    await expect(createPayment("CMD-NOURL", 100)).rejects.toBeInstanceOf(PlopApiError);
  });

  it("createPayment: a 200 response with a malformed (non-JSON) body raises a clean PlopApiError, not a raw SyntaxError", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createPayment, PlopApiError } = await import("../plop-client.server");
    const error = await createPayment("CMD-BADBODY", 100).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlopApiError);
    expect((error as Error).message).not.toMatch(/^Unexpected token|is not valid JSON/i);
  });

  it("verifyPayment: normalizes trans_status 'ok' to success-shaped result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "success",
        montant: 250,
        trans_status: "ok",
        id_transaction: "173763124912345",
        date: "2026-08-04",
        heure: "14:53:11",
        method: "moncash",
        id_client: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment } = await import("../plop-client.server");
    const result = await verifyPayment("CMD-1");

    expect(result.transStatus).toBe("ok");
    expect(result.providerTransactionId).toBe("173763124912345");
    expect(result.amount).toBe(250);
    expect(result.walletUsed).toBe("moncash");
  });

  it("verifyPayment: captures a different wallet than what might have been requested (payment_method:'all' letting the customer pick on PLOP's page)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, montant: 250, trans_status: "ok", method: "natcash" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment } = await import("../plop-client.server");
    const result = await verifyPayment("CMD-ALL-1");

    expect(result.walletUsed).toBe("natcash");
  });

  it("verifyPayment: walletUsed is null when PLOP doesn't return a method field", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, montant: 250, trans_status: "no" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment } = await import("../plop-client.server");
    const result = await verifyPayment("CMD-NOMETHOD");

    expect(result.walletUsed).toBeNull();
  });

  it("verifyPayment: normalizes trans_status 'no' to pending-shaped result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, montant: 250, trans_status: "no" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment } = await import("../plop-client.server");
    const result = await verifyPayment("CMD-2");

    expect(result.transStatus).toBe("no");
  });

  it("verifyPayment: an undocumented trans_status value is reported as 'unknown', never guessed", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: true, montant: 250, trans_status: "expired" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment } = await import("../plop-client.server");
    const result = await verifyPayment("CMD-3");

    expect(result.transStatus).toBe("unknown");
  });

  it("verifyPayment: status:false in the body raises a clean PlopApiError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: false, message: "Client introuvable" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { verifyPayment, PlopApiError } = await import("../plop-client.server");
    await expect(verifyPayment("CMD-4")).rejects.toBeInstanceOf(PlopApiError);
  });
});
