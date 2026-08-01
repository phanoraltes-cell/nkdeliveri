/**
 * Unit tests for the collect-side webhook handler — signature
 * verification delegation, correct RPC dispatch, and idempotent replay
 * handling. Deliberately mirrors moncash-webhook-handler.test.ts's
 * structure but targets complete_collect_payment_secure /
 * payment_transactions, never moncash_webhook_events/payouts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookVerifyResult } from "../types";

const verifyWebhookMock =
  vi.fn<(rawBody: string, headers: Record<string, string>) => Promise<WebhookVerifyResult>>();
vi.mock("../moncash-provider.server", () => ({
  moncashProvider: {
    verifyWebhook: (...args: [string, Record<string, string>]) => verifyWebhookMock(...args),
  },
}));

function buildSupabaseAdminMock(opts: {
  rpcResult?: { data: { status: string } | null; error: { message: string } | null };
}) {
  const rpcResult = opts.rpcResult ?? { data: { status: "paid" }, error: null };
  const rpc = vi.fn(async () => rpcResult);
  return { supabaseAdmin: { rpc } };
}

describe("handleMonCashCollectWebhook", () => {
  beforeEach(() => {
    vi.resetModules();
    verifyWebhookMock.mockReset();
  });

  it("rejects an invalid signature with 401 and never calls an RPC", async () => {
    verifyWebhookMock.mockResolvedValue({ valid: false, error: "bad signature" });
    const { supabaseAdmin } = buildSupabaseAdminMock({});
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.httpStatus).toBe(401);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("a valid success event calls complete_collect_payment_secure with decision 'paid'", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-1",
        ourReference: "REF-1",
        status: "success",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      rpcResult: { data: { status: "paid" }, error: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.httpStatus).toBe(200);
    expect(result.body.outcome).toBe("paid");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_collect_payment_secure",
      expect.objectContaining({ _external_reference: "REF-1", _decision: "paid" }),
    );
  });

  it("a valid failed event calls complete_collect_payment_secure with decision 'failed'", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-2",
        ourReference: "REF-2",
        status: "failed",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      rpcResult: { data: { status: "failed" }, error: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.body.outcome).toBe("failed");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_collect_payment_secure",
      expect.objectContaining({ _decision: "failed" }),
    );
  });

  it("a pending status is ignored, no RPC called", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-3",
        ourReference: "REF-3",
        status: "pending",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({});
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.body.outcome).toBe("ignored");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("an event with no ourReference is ignored, no RPC called", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: { providerReference: "MONCASH-TX-4", ourReference: null, status: "success", raw: {} },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({});
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.body.outcome).toBe("ignored");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("a replayed delivery for an already-decided transaction is idempotent, not an error", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-5",
        ourReference: "REF-5",
        status: "success",
        raw: {},
      },
    });
    // The RPC's own idempotency guard returns the row as-is on a replay
    // (status already 'paid') -- same shape as a fresh success, no
    // special "duplicate" signal needed for this to be safe.
    const { supabaseAdmin } = buildSupabaseAdminMock({
      rpcResult: { data: { status: "paid" }, error: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result1 = await handleMonCashCollectWebhook("{}", {});
    const result2 = await handleMonCashCollectWebhook("{}", {});

    expect(result1.httpStatus).toBe(200);
    expect(result2.httpStatus).toBe(200);
    expect(result1.body.outcome).toBe("paid");
    expect(result2.body.outcome).toBe("paid");
  });

  it("an unknown reference (RPC throws) surfaces as a 500, never a silent success", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-6",
        ourReference: "REF-UNKNOWN",
        status: "success",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      rpcResult: { data: null, error: { message: "Pa gen tranzaksyon peman pou referans sa a" } },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashCollectWebhook } =
      await import("../moncash-collect-webhook-handler.server");
    const result = await handleMonCashCollectWebhook("{}", {});

    expect(result.httpStatus).toBe(500);
    expect(result.body.ok).toBe(false);
  });
});
