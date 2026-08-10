// Standalone Node HTTP server standing in for Supabase during E2E runs.
// Started by playwright.config.ts's webServer array, before the app
// server. Two jobs:
//
// 1. Answer the handful of deterministic queries TanStack Start's SSR
//    loaders issue for the public pages (/, /restaurants,
//    /restaurants/$slug, /sitemap.xml) — these run in the Node process
//    handling the request, never inside the browser Playwright controls,
//    so page.route() cannot intercept them (see docs/E2E_TEST_REPORT.md
//    § Known limitations for the full explanation). VITE_SUPABASE_URL is
//    rebuilt to point here for the whole --mode e2e build, so this is
//    genuinely the only backend either process can reach.
// 2. Act as a safety-net fallback for any browser-side request a spec
//    didn't explicitly mock via page.route() — falling through to this
//    same local server (never production) on a coverage gap, per the
//    plan's explicit "safer than matching the real hostname" design.
//
// Deliberately plain `node:http`, no framework — this only ever needs to
// answer a handful of GET-shaped PostgREST-style requests.
import { createServer } from "node:http";
import {
  restaurant,
  menuCategory,
  product,
  driver,
  order,
  payment,
  delivery,
  dispute,
  wallet,
  sponsoredPlacement,
  notification,
} from "../fixtures/data";
import { PRIMARY_ROLE, userRolesRows, type FixtureRole } from "../fixtures/users";

const PORT = 54321;
const HOST = "127.0.0.1";

const TABLE_FIXTURES: Record<string, unknown> = {
  restaurants: [restaurant],
  menu_categories: [menuCategory],
  products: [product],
  drivers: [driver],
  orders: [order],
  payments: [payment],
  deliveries: [delivery],
  disputes: [dispute],
  sponsored_placements: [sponsoredPlacement],
  notifications: [notification],
  wallets: [wallet.restaurant, wallet.driver],
  user_roles: userRolesRows("customer" as FixtureRole),
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Range": "0-0/1",
    ...corsHeaders(),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  if (rpcMatch) {
    const name = rpcMatch[1];
    if (name === "get_primary_role") {
      sendJson(res, 200, PRIMARY_ROLE.customer);
      return;
    }
    if (name === "check_auth_rate_limit_secure") {
      sendJson(res, 200, true);
      return;
    }
    console.warn(`[ssr-bootstrap-server] unmapped RPC: ${name} (returning null)`);
    sendJson(res, 200, null);
    return;
  }

  const tableMatch = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (tableMatch) {
    const table = tableMatch[1];
    const slug = url.searchParams.get("slug");
    if (table === "restaurants" && slug) {
      const [, value] = slug.split(".");
      sendJson(res, 200, value === restaurant.slug ? [restaurant] : []);
      return;
    }
    if (table in TABLE_FIXTURES) {
      sendJson(res, 200, TABLE_FIXTURES[table]);
      return;
    }
    console.warn(`[ssr-bootstrap-server] unmapped table: ${table} (returning [])`);
    sendJson(res, 200, []);
    return;
  }

  if (url.pathname.startsWith("/auth/v1/")) {
    // No spec relies on the SSR server for auth (mockSupabaseAuth seeds
    // localStorage directly; the login/register specs mock auth:token
    // client-side via page.route()) — a safe empty default is enough.
    sendJson(res, 200, { user: null, session: null });
    return;
  }

  console.warn(
    `[ssr-bootstrap-server] unmapped path: ${req.method} ${url.pathname} (returning [])`,
  );
  sendJson(res, 200, []);
});

server.listen(PORT, HOST, () => {
  console.log(`[ssr-bootstrap-server] listening on http://${HOST}:${PORT}`);
});
