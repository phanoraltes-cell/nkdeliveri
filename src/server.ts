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

// Static, non-script-src directives — unchanged from the previous
// vercel.json-only policy. script-src carries a per-request nonce instead of
// 'unsafe-inline' (see getRouter() in src/router.tsx for how the same nonce
// reaches every inline script TanStack Start emits).
const CSP_BASE =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://router.project-osrm.org; upgrade-insecure-requests";

function buildCsp(nonce: string): string {
  return `script-src 'self' 'nonce-${nonce}'; ${CSP_BASE}`;
}

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
      return normalized;
    } catch (error) {
      console.error(error);
      captureExceptionServer(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "Content-Security-Policy": buildCsp(nonce),
        },
      });
    }
  },
};
