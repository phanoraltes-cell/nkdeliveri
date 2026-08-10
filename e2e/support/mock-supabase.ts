// Core mock harness — every spec in this suite goes through here rather
// than hand-rolling page.route() calls, so the "never hit real
// production Supabase" guarantee lives in exactly one place.
//
// Architecture recap (see docs/E2E_TEST_REPORT.md § Known limitations
// for the full picture): VITE_SUPABASE_URL is rebuilt to point at a
// local mock server (e2e/mocks/ssr-bootstrap-server.ts) for the whole
// `--mode e2e` build, so both the TanStack Start SSR loaders (Node
// process) and the browser's own fetch calls resolve to
// http://127.0.0.1:54321 automatically — no app code changes needed.
// This module only ever intercepts *browser*-side requests to that same
// origin; the SSR server is a separate, independent process answering
// the same fixture data (see ssr-bootstrap-server.ts).
import type { Page, Route } from "@playwright/test";
import { buildSession, PRIMARY_ROLE, userRolesRows, type FixtureRole } from "../fixtures/users";

export const MOCK_SUPABASE_URL = "http://127.0.0.1:54321";

// Confirmed empirically against the installed @supabase/supabase-js:
// storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`.
// For http://127.0.0.1:54321, hostname "127.0.0.1" split on "." -> "127".
export const STORAGE_KEY = "sb-127-auth-token";

export type RouteHandler = unknown | ((route: Route) => void | Promise<void>);
export type RouteHandlers = Record<string, RouteHandler>;

/**
 * Seeds an "already logged in as `role`" browser state and disarms
 * realtime WebSocket connections, both via a single addInitScript so
 * they run before the app's own first script (must be called before any
 * page.goto() in the test — addInitScript only affects documents loaded
 * afterward).
 */
export async function mockSupabaseAuth(page: Page, role: FixtureRole): Promise<void> {
  const session = buildSession(role);
  await page.addInitScript(
    ({ key, session, wsHost }) => {
      window.localStorage.setItem(key, JSON.stringify(session));

      // Realtime channels (postgres_changes subscriptions opened by every
      // authenticated dashboard page) use a real WebSocket that
      // page.route() cannot intercept. No spec in this suite asserts on a
      // live realtime push (every flow is validated via explicit user
      // actions + mocked RPC/REST responses), so the simplest safe
      // behavior is a permanently-inert stub for this host only — never
      // opens, never errors, leaves any other WebSocket usage (none
      // elsewhere in this app) unaffected.
      const RealWebSocket = window.WebSocket;
      class InertWebSocket extends EventTarget {
        readyState = 0;
        constructor(url: string | URL, protocols?: string | string[]) {
          super();
          const asString = url.toString();
          if (asString.includes(wsHost)) {
            return; // intentional no-op: never connects, never emits
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new RealWebSocket(url, protocols) as any;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).WebSocket = InertWebSocket;
    },
    { key: STORAGE_KEY, session, wsHost: "127.0.0.1:54321" },
  );
}

/**
 * Base REST/RPC handlers every authenticated page needs regardless of
 * role: the two independent role-resolution calls
 * (`_authenticated/route.tsx`'s beforeLoad AND useAuth.tsx both call
 * get_primary_role; the route guard additionally selects `user_roles`
 * directly) plus an empty notifications feed default. Spec files spread
 * this first, then layer their own flow-specific handlers on top.
 */
export function baseHandlersForRole(role: FixtureRole): RouteHandlers {
  return {
    "rpc:get_primary_role": PRIMARY_ROLE[role],
    "table:user_roles": userRolesRows(role),
    "table:notifications": [],
  };
}

/**
 * Registers ONE catch-all page.route() covering two independent
 * concerns, deliberately unified into a single handler rather than two
 * separate page.route() calls — Playwright evaluates overlapping route
 * patterns last-registered-first, so two calls would race on ordering
 * for any request matching both:
 *
 * 1. Strips the app's Content-Security-Policy header from the top-level
 *    document response. src/server.ts sets a hardcoded
 *    `connect-src 'self' https://*.supabase.co ...` (production
 *    hardening, correctly strict, not something this suite should ever
 *    weaken in the real app) that blocks the browser from reaching
 *    127.0.0.1 — the mock Supabase origin — even though
 *    VITE_SUPABASE_URL was rebuilt to point there. Stripped only inside
 *    Playwright's controlled browser context; the actual served app
 *    (and its real CSP) is completely untouched.
 * 2. Dispatches REST/RPC/Auth requests to the mock Supabase origin by
 *    parsed path against `handlers`. Any unmapped path falls through to
 *    an empty 200 (never a hang, never a silent pass-through to a real
 *    network — nothing outside 127.0.0.1:54321 is ever reachable in the
 *    e2e build) plus a console warning, so a spec missing a mock for a
 *    newly-added call fails loudly via that warning rather than
 *    mysteriously.
 */
export async function mockSupabaseRoute(page: Page, handlers: RouteHandlers): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.resourceType() === "document" && url.origin !== MOCK_SUPABASE_URL) {
      // route.fetch() is a real network round-trip, which fails once the
      // browser context is offline (cross-cutting/offline.spec.ts) —
      // fall back to route.continue() in that case so the browser's own
      // Cache Storage / service worker serves the (already precached
      // while online) response instead, exactly what an offline test
      // needs. Harmless for the normal online path too, just a rarer
      // fallback there.
      try {
        const response = await route.fetch();
        const responseHeaders = response.headers();
        delete responseHeaders["content-security-policy"];
        await route.fulfill({ response, headers: responseHeaders });
      } catch {
        await route.continue();
      }
      return;
    }

    if (url.origin !== MOCK_SUPABASE_URL) {
      await route.continue();
      return;
    }

    const key = routeKey(url);
    const handler = key ? handlers[key] : undefined;

    if (typeof handler === "function") {
      await (handler as (route: Route) => void | Promise<void>)(route);
      return;
    }
    if (handler !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify(handler),
      });
      return;
    }

    console.warn(`[e2e mock] unmapped Supabase request: ${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

function routeKey(url: URL): string | null {
  const path = url.pathname;
  const rpcMatch = path.match(/\/rest\/v1\/rpc\/([^/]+)$/);
  if (rpcMatch) return `rpc:${rpcMatch[1]}`;
  const tableMatch = path.match(/\/rest\/v1\/([^/]+)$/);
  if (tableMatch) return `table:${tableMatch[1]}`;
  if (path.startsWith("/auth/v1/token")) return "auth:token";
  if (path.startsWith("/auth/v1/signup")) return "auth:signup";
  if (path.startsWith("/auth/v1/resend")) return "auth:resend";
  if (path.startsWith("/storage/v1/")) return "storage";
  return null;
}

/**
 * Handler fragments for the dedicated login/register specs, which
 * exercise the real form submission (not the localStorage-seed
 * shortcut). Returned as plain objects — never call mockSupabaseRoute()
 * more than once per test, since each call registers its own
 * page.route() and only the most-recently-registered one intercepts a
 * given request; spec files spread these into one combined handlers
 * object instead.
 */
export function loginHandlers(role: FixtureRole): RouteHandlers {
  const session = buildSession(role);
  return {
    "rpc:check_auth_rate_limit_secure": true,
    "auth:token": (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      }),
  };
}

export function registerHandlers(role: FixtureRole): RouteHandlers {
  const session = buildSession(role);
  return {
    "rpc:check_auth_rate_limit_secure": true,
    "auth:signup": (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      }),
  };
}
