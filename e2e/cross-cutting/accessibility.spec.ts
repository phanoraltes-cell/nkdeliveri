import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { buildAxe } from "../support/a11y";
import {
  restaurant,
  product,
  order,
  payment,
  driver,
  wallet,
  paymentProviderSettings,
} from "../fixtures/data";

function severe(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

test.describe("Accessibility — WCAG2A/AA (zero critical/serious violations)", () => {
  test("home page", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:products": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("restaurant list", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("restaurant detail", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:reviews": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto(`/restaurants/${restaurant.slug}`);
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("checkout (cash flow)", async ({ page }) => {
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
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("customer dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, { ...baseHandlersForRole("customer"), "table:orders": [order] });
    await page.goto("/dashboard/customer");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("restaurant dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:orders": [{ ...order, status: "pending", restaurants: restaurant }],
      "table:restaurants": [restaurant],
    });
    await page.goto("/dashboard/restaurant/orders");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("driver dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:wallets": [wallet.driver],
    });
    await page.goto("/dashboard/driver");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("admin dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:restaurants": [],
      "table:drivers": [],
      "table:orders": [],
    });
    await page.goto("/dashboard/admin");
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  // Refonte Frontend Premium, Phase 7 (P7) — /orders/$id had zero axe
  // coverage despite being named explicitly in the P7 scope (Timeline).
  // Two statuses: the normal step timeline, and the cancelled/refunded
  // flat-state branch (a structurally different render path in
  // OrderStatusTimeline, not just a different label).
  //
  // KNOWN LIMITATION (pre-existing, not introduced here — see
  // docs/E2E_TEST_REPORT.md's SSR/browser mock-split note and this
  // module's own top-of-file comment): mockSupabaseAuth only seeds
  // *browser* localStorage; it has no way to authenticate the *SSR*
  // pass a bare page.goto() triggers, so a fresh full-page load of any
  // protected route can render the logged-out /auth screen instead of
  // the intended page. Confirmed during P7 that this already affects
  // every other page.goto()-based authenticated-route test in this same
  // file (customer/restaurant/driver/admin dashboard), not just these
  // two — axe still scans *something* and a real violation on the login
  // screen would still fail the test, but a clean pass here does not by
  // itself prove the Timeline was what got scanned. Left in (matches
  // this file's existing convention for every other protected route,
  // and starts providing real signal the moment the harness gap above
  // is fixed) rather than removed or reworked into a new pattern.
  test("order tracking — active timeline", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "preparing", payments: [{ ...payment, status: "paid" }] },
      "table:disputes": [],
      "table:refunds": [],
    });
    await page.goto(`/orders/${order.id}`);
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });

  test("order tracking — cancelled flat state", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "cancelled", payments: [payment] },
      "table:disputes": [],
      "table:refunds": [],
    });
    await page.goto(`/orders/${order.id}`);
    const results = await buildAxe(page).analyze();
    expect(severe(results.violations)).toEqual([]);
  });
});
