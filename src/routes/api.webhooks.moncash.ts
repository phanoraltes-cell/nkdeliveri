import { createFileRoute } from "@tanstack/react-router";

/**
 * Public HTTP endpoint MonCash calls to report payment status changes —
 * https://www.nkdeliveri.com/api/webhooks/moncash. Deliberately a raw
 * route (`server.handlers`, same shape as robots.txt.ts/sitemap.xml.ts),
 * not a `createServerFn`: a `createServerFn` endpoint uses TanStack's own
 * internal call framing meant for `useServerFn` clients, not a plain
 * POST from an arbitrary third-party sender.
 *
 * All real logic lives in moncash-webhook-handler.server.ts, reached only
 * through a dynamic import — never a static one. Route files ship to the
 * client bundle in this app (see client.server.ts's own comment); a
 * static import of a `.server.ts` module here would pull the service-role
 * client and MonCash signing logic into that bundle. The dynamic import
 * only ever executes inside this POST handler, which only ever runs
 * server-side, so it never gets bundled for the browser — the same
 * pattern already used by every `*.functions.ts` file in this codebase.
 *
 * See docs/MONCASH_WEBHOOK_SECURITY.md for the full security report.
 */
export const Route = createFileRoute("/api/webhooks/moncash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const headers = Object.fromEntries(request.headers.entries());

        const { handleMonCashWebhook } =
          await import("@/lib/payment-providers/moncash-webhook-handler.server");
        const result = await handleMonCashWebhook(rawBody, headers);

        return new Response(JSON.stringify(result.body), {
          status: result.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
