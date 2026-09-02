/**
 * Tès pou rekonsilyasyon rechaj wallet — ekri APRE ensidan 50 HTG la
 * (yon peman MonCash reyèl ki pa t janm rive nan balans kliyan an).
 * Modil sa a pa t gen okenn tès ditou, se yon rezon kle poukisa lojik
 * ekspirasyon an te ka antere yon peman reyèl san pèsonn pa wè l.
 *
 * Chak tès isit la fikse yon garanti LAJAN, pa yon detay enplemantasyon.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentStatusResult } from "../types";

const checkStatusMock = vi.fn<(ref: string) => Promise<PaymentStatusResult>>();
vi.mock("../plop-provider.server", () => ({
  plopProvider: { checkStatus: (ref: string) => checkStatusMock(ref) },
}));

type IntentRow = { external_reference: string; created_at: string; status: string };

function buildIntentsChain(rows: IntentRow[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.gt = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

function buildSupabaseAdminMock(rows: IntentRow[]) {
  const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "payment_intents") return buildIntentsChain(rows);
    throw new Error(`unexpected table: ${table}`);
  });
  return { supabaseAdmin: { from, rpc } };
}

const OLD = new Date(Date.now() - 3 * 60 * 60_000).toISOString();

describe("reconcilePendingWalletTopups", () => {
  beforeEach(() => {
    vi.resetModules();
    checkStatusMock.mockReset();
  });

  it("credits a still-pending intent through complete_wallet_topup_secure", async () => {
    checkStatusMock.mockResolvedValue({ status: "success", providerReference: "PLOP-TX-1" });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-1", created_at: OLD, status: "pending" },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingWalletTopups } = await import("../plop-wallet-topup-reconcile.server");
    const summary = await reconcilePendingWalletTopups();

    expect(summary.results).toEqual([{ externalReference: "REF-1", outcome: "confirmed" }]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_wallet_topup_secure",
      expect.objectContaining({ _external_reference: "REF-1", _decision: "succeeded" }),
    );
  });

  it("GARANTI LAJAN — rescues an intent wrongly marked 'expired' when PLOP confirms it was paid", async () => {
    checkStatusMock.mockResolvedValue({ status: "success", providerReference: "PLOP-TX-2" });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-2", created_at: OLD, status: "expired" },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingWalletTopups } = await import("../plop-wallet-topup-reconcile.server");
    const summary = await reconcilePendingWalletTopups();

    expect(summary.results).toEqual([{ externalReference: "REF-2", outcome: "recovered" }]);
    // complete_wallet_topup_secure ONLY acts on status='pending', so an
    // expired row must go through the recovery RPC or the money stays lost.
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "admin_recover_wallet_topup_secure",
      expect.objectContaining({ _external_reference: "REF-2" }),
    );
  });

  it("GARANTI LAJAN — never expires with a window shorter than 24h", async () => {
    const { supabaseAdmin } = buildSupabaseAdminMock([]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingWalletTopups } = await import("../plop-wallet-topup-reconcile.server");
    await reconcilePendingWalletTopups();

    const expireCall = supabaseAdmin.rpc.mock.calls.find(
      (c) => c[0] === "expire_stale_wallet_topups_secure",
    );
    expect(expireCall).toBeDefined();
    expect(expireCall?.[1]?._older_than_minutes).toBeGreaterThanOrEqual(1440);
  });

  it("marks an explicitly-failed payment as failed instead of leaving it to silently expire", async () => {
    checkStatusMock.mockResolvedValue({ status: "failed", error: "Rejected by MonCash" });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-3", created_at: OLD, status: "pending" },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingWalletTopups } = await import("../plop-wallet-topup-reconcile.server");
    const summary = await reconcilePendingWalletTopups();

    expect(summary.results).toEqual([{ externalReference: "REF-3", outcome: "failed" }]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "complete_wallet_topup_secure",
      expect.objectContaining({ _external_reference: "REF-3", _decision: "failed" }),
    );
  });

  it("never credits on an ambiguous answer — 'unknown' stays pending, nothing is written", async () => {
    checkStatusMock.mockResolvedValue({ status: "unknown", error: "network" });
    const { supabaseAdmin } = buildSupabaseAdminMock([
      { external_reference: "REF-4", created_at: OLD, status: "pending" },
    ]);
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

    const { reconcilePendingWalletTopups } = await import("../plop-wallet-topup-reconcile.server");
    const summary = await reconcilePendingWalletTopups();

    expect(summary.results).toEqual([{ externalReference: "REF-4", outcome: "still_pending" }]);
    const creditCalls = supabaseAdmin.rpc.mock.calls.filter(
      (c) => c[0] !== "expire_stale_wallet_topups_secure",
    );
    expect(creditCalls).toHaveLength(0);
  });
});
