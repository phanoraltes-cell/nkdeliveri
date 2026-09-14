import { createFileRoute } from "@tanstack/react-router";
import { apiMethods } from "@/lib/api-methods";

/**
 * Vercel Cron target — see vercel.json's `crons` entry. Reconciles PLOP
 * Collect payments stuck in `pending` — the safety-net role only, never
 * the primary confirmation path (see the callout in
 * docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 3 and the module comment on
 * plop-reconcile.server.ts). Runs once a day — the Vercel Hobby plan's
 * ceiling on Cron Job frequency, already the case for
 * api.cron.moncash-reconcile.ts.
 *
 * Also runs NKD-021's daily retention cleanup (docs/NKD-021_DATA_RETENTION_
 * REPORT.md) — owner-confirmed to piggyback here rather than register a
 * third Vercel Cron entry: the Hobby plan caps a project at 2 Cron Jobs
 * total, not just frequency, and this project already has exactly 2
 * (this route + moncash-reconcile). Deliberately its own try/catch,
 * separate from the PLOP reconciliation above — an unrelated retention
 * failure must never get reported as (or mask) a payment-reconciliation
 * failure, and vice versa.
 *
 * Also runs the wallet-balance reconciliation check (audit remediation
 * 2026-08-27, FIN-001) for the exact same reason — a 3rd standalone cron
 * still isn't available on the Hobby plan. wallets.available_balance is a
 * stored running total; this detects (never auto-corrects, see the
 * migration's own comment) drift against commission_ledger. Own try/catch,
 * same isolation reasoning as the retention block above.
 *
 * Also runs the customer wallet top-up reconciliation (Tach 1B, PROMPT
 * MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) — same Hobby-plan-cron-limit
 * reasoning, a 4th isolated try/catch block, never allowed to mask or be
 * masked by the 3 concerns above.
 *
 * Protected by CRON_SECRET (same convention as
 * api.cron.moncash-reconcile.ts — Vercel automatically sends
 * `Authorization: Bearer <value>` on scheduled invocations, see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Same dynamic-import-only rule as every other route in this app: never
 * a static import of a `.server.ts` module here.
 */
export const Route = createFileRoute("/api/cron/plop-reconcile")({
  server: {
    handlers: apiMethods({
      GET: async ({ request }) => {
        const { isValidCronRequest } = await import("@/lib/cron-auth.server");
        const auth = isValidCronRequest(request);
        if (!auth.ok) {
          return new Response(JSON.stringify({ ok: false, error: auth.error }), {
            status: auth.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        let plopResult: { ok: true; summary: unknown } | { ok: false; error: string };
        try {
          const { reconcilePendingPlopPayments } =
            await import("@/lib/payment-providers/plop-reconcile.server");
          const summary = await reconcilePendingPlopPayments();
          plopResult = { ok: true, summary };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[plop-reconcile] failed", message);
          plopResult = { ok: false, error: message };
        }

        // NKD-021 — independent try/catch on purpose (see module comment):
        // must never let a retention-cleanup failure look like (or hide) a
        // PLOP reconciliation failure, or the reverse.
        let retentionResult: { ok: true; summary: unknown } | { ok: false; error: string };
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runDataRetentionCleanup } = await import("@/lib/data-retention-cleanup.server");
          const summary = await runDataRetentionCleanup(supabaseAdmin);
          retentionResult = { ok: true, summary };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[data-retention] failed", message);
          retentionResult = { ok: false, error: message };
        }

        // Same isolation reasoning as retention above: a wallet-reconciliation
        // failure (or a discrepancy it finds) must never look like a PLOP or
        // retention failure, and shouldn't fail the whole cron invocation —
        // Vercel Cron doesn't page anyone on a non-2xx, so 200 with the
        // discrepancy count visible in the response is what actually gets
        // noticed (logs/manual check), not a silent 500 buried in the mix.
        let walletReconciliationResult:
          { ok: true; summary: unknown } | { ok: false; error: string };
        try {
          const { runWalletReconciliation } = await import("@/lib/wallet-reconciliation.server");
          const summary = await runWalletReconciliation();
          walletReconciliationResult = { ok: true, summary };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[wallet-reconciliation] failed", message);
          walletReconciliationResult = { ok: false, error: message };
        }

        // Tach 1B — menm izolasyon: yon echèk rekonsilyasyon rechaj wallet
        // pa dwe janm kache/kaptire pa okenn nan 3 lòt konsèn yo pi wo a.
        let walletTopupResult: { ok: true; summary: unknown } | { ok: false; error: string };
        try {
          const { reconcilePendingWalletTopups } =
            await import("@/lib/payment-providers/plop-wallet-topup-reconcile.server");
          const summary = await reconcilePendingWalletTopups();
          walletTopupResult = { ok: true, summary };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[wallet-topup-reconcile] failed", message);
          walletTopupResult = { ok: false, error: message };
        }

        return new Response(
          JSON.stringify({
            ok: plopResult.ok,
            plop: plopResult,
            retention: retentionResult,
            walletReconciliation: walletReconciliationResult,
            walletTopup: walletTopupResult,
          }),
          {
            status: plopResult.ok ? 200 : 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    }),
  },
});
