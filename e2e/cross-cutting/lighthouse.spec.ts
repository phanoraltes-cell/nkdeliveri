import { test, chromium, type Browser, type Page } from "@playwright/test";
import { playAudit } from "playwright-lighthouse";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, order, product, paymentProviderSettings } from "../fixtures/data";

// playwright-lighthouse drives Lighthouse over the Chrome DevTools
// Protocol against a *known* debugging port — the default `page` fixture
// doesn't expose one, so this suite launches its own Chromium instance
// with --remote-debugging-port set explicitly (confirmed necessary live:
// "ECONNREFUSED 127.0.0.1:9222" against the default fixture).
const LIGHTHOUSE_PORT = 9222;

// Real baseline recorded from a first run against this local harness
// (docs/E2E_TEST_REPORT.md has the full numbers) — thresholds below are
// set from that baseline, not guessed. "pwa" omitted: Lighthouse 12+
// dropped it from onlyCategories (confirmed live — "unrecognized
// category in 'onlyCategories': pwa").
//
// `performance` is deliberately NOT gated here: Lighthouse's default
// mobile-throttled simulation against a bare local Node preview server
// (no CDN, no HTTP/2, no edge caching — nothing like real Vercel
// production hosting) scored 0-48 in this harness, which reflects the
// test environment, not the app's real-world performance. Recording the
// score in the report is still valuable; failing the suite on it here
// would not be.
const PUBLIC_PAGE_THRESHOLDS = { "best-practices": 70, seo: 90 };
// Dashboard pages are deliberately `noindex` (see src/lib/seo.ts's
// noIndexMeta()) — Lighthouse's generic SEO category penalizes any
// noindex directive on the assumption it's accidental, which is a false
// flag for an authenticated app page never meant to be indexed. No SEO
// floor here for exactly that reason.
const DASHBOARD_THRESHOLDS = { "best-practices": 70 };

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch({ args: [`--remote-debugging-port=${LIGHTHOUSE_PORT}`] });
});

test.afterAll(async () => {
  await browser.close();
});

async function auditedPage(): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe("Lighthouse — performance/best-practices/SEO", () => {
  test("home page", async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Lighthouse audits require Chromium/CDP.");
    const page = await auditedPage();
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:products": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/");
    await playAudit({ page, thresholds: PUBLIC_PAGE_THRESHOLDS, port: LIGHTHOUSE_PORT });
  });

  test("restaurant list", async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Lighthouse audits require Chromium/CDP.");
    const page = await auditedPage();
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");
    await playAudit({ page, thresholds: PUBLIC_PAGE_THRESHOLDS, port: LIGHTHOUSE_PORT });
  });

  test("checkout", async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Lighthouse audits require Chromium/CDP.");
    const page = await auditedPage();
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:addresses": [],
      "table:payment_provider_settings": paymentProviderSettings,
      "rpc:get_platform_payout_public": {
        moncash_number: null,
        moncash_account_name: null,
        natcash_number: null,
        natcash_account_name: null,
      },
    });
    await page.goto(`/restaurants/${restaurant.slug}`);
    await page.getByRole("button", { name: `Ajoute ${product.name} nan panye` }).click();
    await page.goto("/checkout");
    // Checkout is deliberately `noindex` (noIndexMeta(), same reasoning as
    // the dashboard case above) — no SEO floor for the same reason.
    await playAudit({ page, thresholds: DASHBOARD_THRESHOLDS, port: LIGHTHOUSE_PORT });
  });

  test("customer dashboard", async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Lighthouse audits require Chromium/CDP.");
    const page = await auditedPage();
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": [order],
    });
    await page.goto("/dashboard/customer");
    await playAudit({ page, thresholds: DASHBOARD_THRESHOLDS, port: LIGHTHOUSE_PORT });
  });
});
