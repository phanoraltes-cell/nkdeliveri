/**
 * Unit tests for the daily PLOP Collect reconciliation job — the
 * safety-net path only (docs/PLOP_PHASE1_ARCHITECTURE.md § 3), never the
 * primary confirmation mechanism. Database and `plopProvider.checkStatus()`
 * are both mocked; the RPC-level idempotence this relies on
 * (`complete_collect_payment_secure`'s own `WHERE status='pending'`
 * guard) is verified separately against the live schema. Mirrors
 * moncash-reconcile.test.ts's structure — including, since the Phase 2
 * audit (docs/PLOP_PHASE2_AUDIT.md § A6), mocking the provider layer
 * (`plopProvider`) rather than the low-level client, matching what
 * plop-reconcile.server.ts now actually calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentStatusResult } from "../types";

const checkStatusMock = vi.fn<(ref: string) => Promise<PaymentStatusResult>>();
vi.mock("../plop-provider.server", () => ({
  plopProvider: { checkStatus: (ref: string) => checkStatusMock(ref) },
}));

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  data?: Record<string, unknown>;
};
const pushToUsersMock = vi.fn(async (_userIds: string[], _payload: PushPayload) => ({ sent: 1 }));
vi.mock("@/lib/push-dispatch.server", () => ({
  pushToUsers: (userIds: string[], payload: PushPayload) => pushToUsersMock(userIds, payload),
}));

type PendingRow = { external_reference: string; created_at: string };

function buildPendingChain(rows: PendingRow[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

function buildUserRolesChain(userIds: string[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: userIds.map((user_id) => ({ user_id })), error: null }).then(resolve);
  return chain;
}

/**
 * Default `rpc` mock dispatches by function name so a single helper covers
 * both `complete_collect_payment_secure` (existing behavior) and
 * `flag_stale_collect_payment_secure` (docs/BACKEND_PAYMENT_REMEDIATION.md)
 * without every pre-existing test needing to know about the new one.
 */
function buildSupabaseAdminMock(
  rows: PendingRow[],
  opts: {
    completeRpcImpl?: () => Promise<{ error: { message: string } | null }>;
    flagRpcImpl?: () => Promise<{
      data:
        | {
            just_flagged: boolean;
            amount: number | null;
            payment_id: string | null;
            order_id: string | null;
          }[]
        | null;
      error: { message: string } | null;
    }>;
    adminIds?: string[];
  } = {},
) {
  const completeRpcImpl = opts.completeRpcImpl ?? (async () => ({ error: null }));
  const flagRpcImpl =
    opts.flagRpcImpl ??
    (async () => ({
      data: [{ just_flagged: true, amount: 1150, payment_id: "PAY-1", order_id: "ORDER-1" }],
      error: null,
    }));
  const rpc = vi.fn((fn: string) => {
    if (fn === "complete_collect_payment_secure") return completeRpcImpl();
    if (fn === "flag_stale_collect_payment_secure") return flagRpcImpl();
    throw new Error(`unexpected rpc: ${fn}`);
  });
  const from = vi.fn((table: string) => {
    if (table === "payment_transactions") return buildPendingChain(rows);
    if (table === "user_roles") return buildUserRolesChain(opts.adminIds ?? ["ADMIN-1"]);
    throw new Error(`unexpected table: ${table}`);
  });
  return { supabaseAdmin: { from, rpc } };
}

function recentIso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

const ELEVEN_MIN_MS = 11 * 60_000;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60_000;

describe("reconcilePendingPlopPayments", () => {
  beforeEach(() => {
    vi.resetModules();
    checkStatusMock.mockReset();
    pushToUsersMock.mockClear();
  });

  it("returns candidates:0 when nothing is pending", async () => {
    const { supabaseAdmin } = buildSupabaseAdminMock([]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.candidates).toBe(0);
    expect(checkStatusMock).not.toHaveBeenCalled();
  });

  it("propagates a failure of the initial SELECT rather than swallowing it (A8)", async () => {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.lt = vi.fn(() => chain);
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve);
      return chain;
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: { from, rpc: vi.fn() },
    }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    await expect(reconcilePendingPlopPayments()).rejects.toThrow("connection reset");
  });

  it("confirms via complete_collect_payment_secure when checkStatus reports success, propagating walletUsed as payment_method_used", async () => {
    checkStatusMock.mockResolvedValue({
      status: "success",
      providerReference: "TX-1",
      walletUsed: "natcash",
      raw: { trans_status: "ok" },
    });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-1", created_at: recentIso(ELEVEN_MIN_MS) },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([{ externalReference: "REF-1", outcome: "confirmed" }]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_collect_payment_secure",
      expect.objectContaining({
        _external_reference: "REF-1",
        _decision: "paid",
        _provider_transaction_id: "TX-1",
        _payment_method_used: "natcash",
      }),
    );
  });

  it("reports outcome:'rpc_error' (distinct from still_pending) when the RPC fails after PLOP already confirmed (A3)", async () => {
    checkStatusMock.mockResolvedValue({
      status: "success",
      providerReference: "TX-2",
      raw: {},
    });
    const { supabaseAdmin } = buildSupabaseAdminMock(
      [{ external_reference: "REF-2", created_at: recentIso(ELEVEN_MIN_MS) }],
      { completeRpcImpl: async () => ({ error: { message: "deadlock detected" } }) },
    );
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([{ externalReference: "REF-2", outcome: "rpc_error" }]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("RPC FAILED AFTER PLOP CONFIRMED"),
    );
    errorSpy.mockRestore();
  });

  it("still_pending when checkStatus reports pending and not yet stale — no RPC called", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending", raw: {} });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-3", created_at: recentIso(ELEVEN_MIN_MS) },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([{ externalReference: "REF-3", outcome: "still_pending" }]);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("treats status:'unknown' the same as 'pending' for staleness purposes — never a guessed failure (A2)", async () => {
    checkStatusMock.mockResolvedValue({ status: "unknown", error: "network blip" });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-4", created_at: recentIso(ELEVEN_MIN_MS) },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([{ externalReference: "REF-4", outcome: "still_pending" }]);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("flags for manual review once stale (>3 days), never guessing a 'failed' decision — calls flag_stale_collect_payment_secure and sends exactly one admin push (docs/BACKEND_PAYMENT_REMEDIATION.md)", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending", raw: {} });
    const { supabaseAdmin } = buildSupabaseAdminMock(
      [{ external_reference: "REF-5", created_at: recentIso(FOUR_DAYS_MS) }],
      { adminIds: ["ADMIN-1", "ADMIN-2"] },
    );
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([
      { externalReference: "REF-5", outcome: "needs_manual_review" },
    ]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("flag_stale_collect_payment_secure", {
      _external_reference: "REF-5",
    });
    // complete_collect_payment_secure must never be called for a merely-stale (not confirmed) transaction.
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith(
      "complete_collect_payment_secure",
      expect.anything(),
    );
    expect(pushToUsersMock).toHaveBeenCalledTimes(1);
    expect(pushToUsersMock).toHaveBeenCalledWith(
      ["ADMIN-1", "ADMIN-2"],
      expect.objectContaining({ tag: "collect-payment-stale-REF-5" }),
    );
    errorSpy.mockRestore();
  });

  it("does NOT send a repeat push when flag_stale_collect_payment_secure reports just_flagged:false (already flagged on a previous day's run)", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending", raw: {} });
    const { supabaseAdmin } = buildSupabaseAdminMock(
      [{ external_reference: "REF-6", created_at: recentIso(FOUR_DAYS_MS) }],
      {
        flagRpcImpl: async () => ({
          data: [{ just_flagged: false, amount: 1150, payment_id: "PAY-1", order_id: "ORDER-1" }],
          error: null,
        }),
      },
    );
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([
      { externalReference: "REF-6", outcome: "needs_manual_review" },
    ]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("flag_stale_collect_payment_secure", {
      _external_reference: "REF-6",
    });
    expect(pushToUsersMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("a flag_stale_collect_payment_secure failure is caught and logged, never crashes the reconcile pass or the rest of the batch", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending", raw: {} });
    const { supabaseAdmin } = buildSupabaseAdminMock(
      [{ external_reference: "REF-7", created_at: recentIso(FOUR_DAYS_MS) }],
      { flagRpcImpl: async () => ({ data: null, error: { message: "connection reset" } }) },
    );
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.results).toEqual([
      { externalReference: "REF-7", outcome: "needs_manual_review" },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to flag REF-7 as stale"));
    expect(pushToUsersMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("processes multiple candidates independently in one pass", async () => {
    checkStatusMock.mockImplementation(async (ref: string) => {
      if (ref === "REF-OK") {
        return { status: "success", providerReference: "TX-OK", raw: {} };
      }
      return { status: "pending", raw: {} };
    });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-OK", created_at: recentIso(ELEVEN_MIN_MS) },
      { external_reference: "REF-PENDING", created_at: recentIso(ELEVEN_MIN_MS) },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingPlopPayments } = await import("../plop-reconcile.server");
    const summary = await reconcilePendingPlopPayments();

    expect(summary.candidates).toBe(2);
    expect(summary.results).toEqual(
      expect.arrayContaining([
        { externalReference: "REF-OK", outcome: "confirmed" },
        { externalReference: "REF-PENDING", outcome: "still_pending" },
      ]),
    );
  });
});
