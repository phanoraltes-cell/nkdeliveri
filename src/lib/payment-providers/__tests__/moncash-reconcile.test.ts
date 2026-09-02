/**
 * Unit tests for the long-horizon reconciliation job — the 30s/2min/10min
 * backoff schedule for provider-backed payouts stuck in 'pending' when no
 * immediate answer came back. Database and plopProvider.checkStatus() are
 * both mocked; the RPC-level idempotence/rollback behavior these calls
 * rely on is verified separately against the live schema.
 *
 * Tach 3 (PROMPT MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) — this module
 * moved from the dormant Digicel-direct integration to PLOP's real
 * Withdrawal API; updated here to mock plopProvider (not moncashProvider)
 * and plop_api_logs (not moncash_api_logs), matching that change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentDirection, PaymentStatusResult } from "../types";

const checkStatusMock =
  vi.fn<(ref: string, direction?: PaymentDirection) => Promise<PaymentStatusResult>>();
vi.mock("../plop-provider.server", () => ({
  plopProvider: {
    checkStatus: (ref: string, direction?: PaymentDirection) => checkStatusMock(ref, direction),
  },
}));

type LogsMode = { count: number; lastCheckedAt: string | null };

function buildLogsChain(mode: LogsMode) {
  let isCountQuery = false;
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
    isCountQuery = Boolean(opts?.count);
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: mode.lastCheckedAt ? { created_at: mode.lastCheckedAt } : null,
  }));
  chain.then = (resolve: (v: unknown) => unknown) => {
    const value = isCountQuery ? { count: mode.count, error: null } : { data: [], error: null };
    return Promise.resolve(value).then(resolve);
  };
  return chain;
}

type PayoutRow = { transaction_reference: string; provider_code?: string };

function buildPayoutsChain(rows: PayoutRow[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: rows.map((r) => ({ provider_code: "moncash_api", ...r })),
      error: null,
    }).then(resolve);
  return chain;
}

function buildSupabaseAdminMock(opts: { payouts: PayoutRow[]; logsMode: LogsMode }) {
  const rpc = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "payouts") return buildPayoutsChain(opts.payouts);
    if (table === "plop_api_logs") return buildLogsChain(opts.logsMode);
    throw new Error(`unexpected table: ${table}`);
  });
  return { supabaseAdmin: { from, rpc } };
}

describe("reconcilePendingMonCashPayouts", () => {
  beforeEach(() => {
    vi.resetModules();
    checkStatusMock.mockReset();
  });

  it("returns candidates:0 when nothing is old enough to reconcile", async () => {
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [],
      logsMode: { count: 0, lastCheckedAt: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.candidates).toBe(0);
    expect(checkStatusMock).not.toHaveBeenCalled();
  });

  it("a first-ever check (0 prior attempts) is always due and confirms on success", async () => {
    checkStatusMock.mockResolvedValue({ status: "success", providerReference: "MONCASH-TX-1" });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-1" }],
      logsMode: { count: 0, lastCheckedAt: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([{ transactionReference: "REF-1", outcome: "confirmed" }]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_pending_payout_secure",
      expect.objectContaining({ _transaction_reference: "REF-1" }),
    );
  });

  it("finalizes as failed via fail_pending_payout_secure when MonCash reports failure", async () => {
    checkStatusMock.mockResolvedValue({ status: "failed", error: "Rejected by MonCash" });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-2" }],
      logsMode: { count: 0, lastCheckedAt: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([{ transactionReference: "REF-2", outcome: "failed" }]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "fail_pending_payout_secure",
      expect.objectContaining({ _transaction_reference: "REF-2" }),
    );
  });

  it("still pending after checking calls no RPC at all", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending" });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-3" }],
      logsMode: { count: 0, lastCheckedAt: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([{ transactionReference: "REF-3", outcome: "still_pending" }]);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("respects the backoff window — not due yet if the last check was too recent", async () => {
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-4" }],
      logsMode: { count: 1, lastCheckedAt: new Date().toISOString() }, // just checked
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([{ transactionReference: "REF-4", outcome: "not_yet_due" }]);
    expect(checkStatusMock).not.toHaveBeenCalled();
  });

  it("becomes due again once the backoff window has elapsed", async () => {
    checkStatusMock.mockResolvedValue({ status: "pending" });
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-5" }],
      logsMode: { count: 1, lastCheckedAt: new Date(Date.now() - 60_000).toISOString() }, // 60s ago > 30s tier-1 gap
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([{ transactionReference: "REF-5", outcome: "still_pending" }]);
    expect(checkStatusMock).toHaveBeenCalledWith("REF-5", "disburse");
  });

  it("flags for manual review once the schedule is exhausted, without calling MonCash again", async () => {
    const { supabaseAdmin } = buildSupabaseAdminMock({
      payouts: [{ transaction_reference: "REF-6" }],
      logsMode: { count: 4, lastCheckedAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingMonCashPayouts } = await import("../moncash-reconcile.server");
    const summary = await reconcilePendingMonCashPayouts();

    expect(summary.results).toEqual([
      { transactionReference: "REF-6", outcome: "needs_manual_review" },
    ]);
    expect(checkStatusMock).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
