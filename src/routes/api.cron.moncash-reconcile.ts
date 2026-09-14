import { createFileRoute } from "@tanstack/react-router";
import { apiMethods } from "@/lib/api-methods";

/**
 * Vercel Cron target — see vercel.json's `crons` entry. Reconciles
 * MonCash Automatik payouts stuck in `pending` (the webhook never
 * arrived, or arrived and got lost) using the 30s/2min/10min backoff
 * schedule in moncash-reconcile.server.ts. Inert today: no
 * provider_code='moncash_api' payout can be 'pending' yet (see that
 * file's own comment) — this route runs, finds nothing, and returns
 * `{ candidates: 0 }` every time until MonCash disbursement is real.
 *
 * Protected by CRON_SECRET (Vercel's own convention: set the env var,
 * Vercel automatically sends `Authorization: Bearer <value>` on
 * scheduled invocations — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Same dynamic-import-only rule as every other route in this app: never
 * a static import of a `.server.ts` module here.
 */
export const Route = createFileRoute("/api/cron/moncash-reconcile")({
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

        try {
          const { reconcilePendingMonCashPayouts } =
            await import("@/lib/payment-providers/moncash-reconcile.server");
          const summary = await reconcilePendingMonCashPayouts();
          return new Response(JSON.stringify({ ok: true, ...summary }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[moncash-reconcile] failed", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    }),
  },
});
