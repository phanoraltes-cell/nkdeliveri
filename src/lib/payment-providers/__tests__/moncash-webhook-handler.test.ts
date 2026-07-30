/**
 * Unit tests for moncash-webhook-handler.server.ts — signature
 * verification delegation, idempotency (the moncash_webhook_events
 * UNIQUE(event_id) constraint), and correct RPC dispatch. The database
 * itself is mocked here (see supabase/migrations/... for the real,
 * live-verified idempotency/rollback behavior at the RPC layer, run
 * separately against a rolled-back transaction on the real schema).
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

const pushToUsersMock = vi.fn(async () => ({ sent: 1 }));
vi.mock("@/lib/push-dispatch.server", () => ({ pushToUsers: pushToUsersMock }));

type FakeRow = Record<string, unknown>;

function buildSupabaseAdminMock(opts: {
  insertResult?: { error: { code: string; message: string } | null };
  rpcResult?: { error: { message: string } | null };
  payoutRow?: FakeRow | null;
}) {
  const insertResult = opts.insertResult ?? { error: null };
  const rpcResult = opts.rpcResult ?? { error: null };
  const payoutRow = opts.payoutRow ?? null;

  const rpc = vi.fn(async () => rpcResult);
  const updateEq = vi.fn(async () => ({ error: null }));
  const insert = vi.fn(async () => insertResult);

  const from = vi.fn((table: string) => {
    if (table === "moncash_webhook_events") {
      return {
        insert,
        update: () => ({ eq: updateEq }),
      };
    }
    if (table === "payouts") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: payoutRow }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { supabaseAdmin: { from, rpc } };
}

describe("handleMonCashWebhook", () => {
  beforeEach(() => {
    vi.resetModules();
    verifyWebhookMock.mockReset();
    pushToUsersMock.mockClear();
  });

  it("rejects an invalid signature with 401 and never calls an RPC", async () => {
    verifyWebhookMock.mockResolvedValue({ valid: false, error: "bad signature" });
    const { supabaseAdmin } = buildSupabaseAdminMock({});
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashWebhook } = await import("../moncash-webhook-handler.server");
    const result = await handleMonCashWebhook("{}", {});

    expect(result.httpStatus).toBe(401);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).toHaveBeenCalledWith("moncash_webhook_events");
  });

  it("a duplicate event_id (unique_violation) is acknowledged 200 without reprocessing", async () => {
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
      insertResult: { error: { code: "23505", message: "duplicate key" } },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashWebhook } = await import("../moncash-webhook-handler.server");
    const result = await handleMonCashWebhook("{}", {});

    expect(result.httpStatus).toBe(200);
    expect(result.body.outcome).toBe("duplicate");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("a valid success event calls complete_pending_payout_secure with the right reference", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-2",
        ourReference: "REF-2",
        status: "success",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payoutRow: {
        id: "p1",
        amount: 500,
        paid_by: "admin-1",
        provider_code: "moncash_api",
        restaurants: { owner_id: "owner-1" },
        drivers: null,
      },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashWebhook } = await import("../moncash-webhook-handler.server");
    const result = await handleMonCashWebhook("{}", {});

    expect(result.httpStatus).toBe(200);
    expect(result.body.outcome).toBe("confirmed");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_pending_payout_secure",
      expect.objectContaining({ _transaction_reference: "REF-2", _provider_code: "moncash_api" }),
    );
    // Both the beneficiary and the initiating admin get pushed.
    expect(pushToUsersMock).toHaveBeenCalledTimes(2);
  });

  it("a valid failed event calls fail_pending_payout_secure", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: {
        providerReference: "MONCASH-TX-3",
        ourReference: "REF-3",
        status: "failed",
        raw: {},
      },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payoutRow: {
        id: "p2",
        amount: 100,
        paid_by: "admin-1",
        provider_code: "moncash_api",
        restaurants: null,
        drivers: { user_id: "driver-1" },
      },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashWebhook } = await import("../moncash-webhook-handler.server");
    const result = await handleMonCashWebhook("{}", {});

    expect(result.body.outcome).toBe("failed");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "fail_pending_payout_secure",
      expect.objectContaining({ _transaction_reference: "REF-3" }),
    );
  });

  it("a valid event with no ourReference is recorded but never touches an RPC", async () => {
    verifyWebhookMock.mockResolvedValue({
      valid: true,
      event: { providerReference: "MONCASH-TX-4", ourReference: null, status: "success", raw: {} },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock({});
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { handleMonCashWebhook } = await import("../moncash-webhook-handler.server");
    const result = await handleMonCashWebhook("{}", {});

    expect(result.body.outcome).toBe("ignored");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
