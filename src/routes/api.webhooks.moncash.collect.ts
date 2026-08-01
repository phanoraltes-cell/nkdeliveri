import { createFileRoute } from "@tanstack/react-router";

/**
 * Public HTTP endpoint MonCash calls for the *collect* (customer →
 * platform) flow — distinct from /api/webhooks/moncash (disbursement).
 * Same raw-route shape as that file (never a createServerFn — see its
 * comment for why), same dynamic-import-only rule (a static import here
 * would pull the service-role client into the client bundle).
 *
 * See docs/MONCASH_COLLECT_PHASE1_REPORT.md and
 * docs/MONCASH_COLLECT_PHASE2_VALIDATION_REPORT.md for the full design
 * and validation reports.
 */
export const Route = createFileRoute("/api/webhooks/moncash/collect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const headers = Object.fromEntries(request.headers.entries());

        const { handleMonCashCollectWebhook } =
          await import("@/lib/payment-providers/moncash-collect-webhook-handler.server");
        const result = await handleMonCashCollectWebhook(rawBody, headers);

        return new Response(JSON.stringify(result.body), {
          status: result.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
