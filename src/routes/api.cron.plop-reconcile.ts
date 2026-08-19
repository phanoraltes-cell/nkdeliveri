import { createFileRoute } from "@tanstack/react-router";

/**
 * Vercel Cron target — see vercel.json's `crons` entry. Reconciles PLOP
 * Collect payments stuck in `pending` — the safety-net role only, never
 * the primary confirmation path (see the callout in
 * docs/PLOP_PHASE1_ARCHITECTURE.md § 3 and the module comment on
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
 * Protected by CRON_SECRET (same convention as
 * api.cron.moncash-reconcile.ts — Vercel automatically sends
 * `Authorization: Bearer <value>` on scheduled invocations, see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Same dynamic-import-only rule as every other route in this app: never
 * a static import of a `.server.ts` module here.
 */
export const Route = createFileRoute("/api/cron/plop-reconcile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(JSON.stringify({ ok: false, error: "CRON_SECRET pa konfigire" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${expected}`) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
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

        return new Response(
          JSON.stringify({ ok: plopResult.ok, plop: plopResult, retention: retentionResult }),
          {
            status: plopResult.ok ? 200 : 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
