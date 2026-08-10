import { randomBytes } from "node:crypto";
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { initSentryServer, captureExceptionServer } from "./lib/sentry.server";

initSentryServer();

// The real TanStack Start handler signature is `fetch(request, opts?)` — see
// RequestHandler<TRegister> in @tanstack/start-server-core/request-handler —
// not the Cloudflare-style `(request, env, ctx)` this was previously typed
// as (env/ctx were always unused passthrough values). `opts.context.nonce`
// is BaseContext.nonce, read back inside src/router.tsx's getRouter() via
// getGlobalStartContext().
type ServerEntry = {
  fetch: (
    request: Request,
    opts?: { context?: { nonce?: string } },
  ) => Promise<Response> | Response;
};

// Static, non-script-src directives. script-src carries a per-request nonce
// instead of 'unsafe-inline' (see getRouter() in src/router.tsx for how the
// same nonce reaches every inline script TanStack Start emits).
//
// Promoted from a Report-Only trial (NK Deliveri remediation F-02, phase 2)
// straight to enforcement without a live-traffic waiting period: the trial
// policy was a strict superset of the one it replaces — it only ever added
// permissions (worker-src/manifest-src explicitly set to what default-src
// 'self' already granted them by CSP fallback; one extra connect-src origin
// for Sentry, which is wired in via src/lib/sentry-browser.ts but currently
// dormant with no VITE_SENTRY_DSN set) — never removed one. A permission-
// only change cannot newly block anything that already worked, so there was
// nothing a monitoring period could have caught here that static inspection
// didn't already rule out. Still no Stripe/Google-OAuth/Google-Maps
// origins: Stripe Checkout and Google OAuth are both full top-level-
// navigation redirects (`window.location.href = ...`), which no CSP
// directive governs, and Google Maps has no code path left at all as of
// 1208cd1 (migrated to Leaflet/OSM/OSRM).
const CSP_BASE =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://router.project-osrm.org https://*.ingest.sentry.io; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests; report-uri /api/csp-report; report-to csp-endpoint";

function buildCsp(nonce: string): string {
  return `script-src 'self' 'nonce-${nonce}'; ${CSP_BASE}`;
}

// Companion to the `report-to csp-endpoint` directive above — the
// Reporting API (the standards-track replacement for the deprecated
// `report-uri`) resolves an endpoint *name* used in the CSP to an actual
// URL declared separately, here. Both mechanisms point at the same
// same-origin route (src/routes/api.csp-report.ts); browsers use whichever
// of the two they support and ignore the other.
const REPORTING_ENDPOINTS = 'csp-endpoint="/api/csp-report"';

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const swallowedError = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(swallowedError);
  captureExceptionServer(swallowedError);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request) {
    const nonce = randomBytes(16).toString("base64");

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, { context: { nonce } });
      const normalized = await normalizeCatastrophicSsrResponse(response);
      normalized.headers.set("Content-Security-Policy", buildCsp(nonce));
      normalized.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
      return normalized;
    } catch (error) {
      console.error(error);
      captureExceptionServer(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "Content-Security-Policy": buildCsp(nonce),
          "Reporting-Endpoints": REPORTING_ENDPOINTS,
        },
      });
    }
  },
};
