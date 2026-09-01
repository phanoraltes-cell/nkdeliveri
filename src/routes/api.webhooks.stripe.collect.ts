import { createFileRoute } from "@tanstack/react-router";

/**
 * Public HTTP endpoint Stripe calls for the Collect flow — same raw-route
 * shape as api.webhooks.moncash.collect.ts (never a createServerFn — see
 * that file's own comment for why), same dynamic-import-only rule (a
 * static import here would pull the service-role client into the client
 * bundle). Configure this exact URL
 * (https://www.nkdeliveri.com/api/webhooks/stripe/collect) in the Stripe
 * dashboard, subscribed to `checkout.session.completed` and
 * `checkout.session.expired`, once real Stripe credentials are set — see
 * docs/archive/audits/STRIPE_INTEGRATION_REPORT.md.
 */
export const Route = createFileRoute("/api/webhooks/stripe/collect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const headers = Object.fromEntries(request.headers.entries());

        const { handleStripeCollectWebhook } =
          await import("@/lib/payment-providers/stripe-collect-webhook-handler.server");
        const result = await handleStripeCollectWebhook(rawBody, headers);

        return new Response(JSON.stringify(result.body), {
          status: result.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
