import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, order } from "../fixtures/data";

// Curated, deliberately small subset of layout-sensitive checks —
// re-run across all 4 device projects in playwright.config.ts (Pixel 7,
// iPhone 13, iPad Mini, Desktop Chrome), not the full flow inventory.
test.describe("Responsive — navigation and layout", () => {
  test("public restaurant list renders and is navigable", async ({ page }, testInfo) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");
    await expect(page.getByText(restaurant.name)).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/restaurants-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test("customer dashboard sidebar/nav is reachable", async ({ page }, testInfo) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": [order],
    });
    await page.goto("/dashboard/customer");
    await expect(page).toHaveURL(/\/dashboard\/customer/);
    // toHaveURL resolves on navigation, not on the page's own data having
    // loaded and painted — without waiting for real content, a screenshot
    // taken right after can (and, found during Phase 6, did) capture a
    // blank frame while still passing, since nothing here asserted on
    // *visible* content.
    await expect(page.getByText(/Byenveni/)).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/dashboard-customer-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test("restaurant order Kanban/list is usable", async ({ page }, testInfo) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:orders": [{ ...order, status: "pending", restaurants: restaurant }],
      "table:restaurants": [restaurant],
    });
    await page.goto("/dashboard/restaurant/orders");
    await expect(page).toHaveURL(/\/dashboard\/restaurant\/orders/);

    // P11 (F-03 remediation) — the default view now depends on viewport
    // width (dashboard.restaurant.orders.tsx: < 768px opens on "Lis"
    // instead of "Kanban"), matching Tailwind's own `md` breakpoint. This
    // checks the actual rendered content for whichever default this
    // viewport should get, not just the URL — a URL-only check would pass
    // even if the wrong view (or neither) rendered.
    const width = page.viewportSize()?.width ?? 0;
    const kanbanHeading = page.getByText("Nouvo kòmand");
    // "Tout" is the "Lis" view's own all-orders filter chip — it has no
    // equivalent in the Kanban board, so its presence/absence is a real,
    // view-specific signal, not a guess from the toggle's own label.
    const listAllChip = page.getByRole("button", { name: "Tout" });

    if (width < 768) {
      await expect(listAllChip).toBeVisible();
      await expect(kanbanHeading).not.toBeVisible();
      // The fixture order itself must actually render in this default —
      // not just the chip/toggle chrome around it.
      await expect(page.getByText(order.order_number)).toBeVisible();
      await expect(page.getByRole("button", { name: "Lis" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } else {
      // Same fix as the customer-dashboard test above, and for the same
      // reason: the Kanban board's data (useMyRestaurant, then the orders
      // query keyed on it) loads after navigation resolves, so this waits
      // for a real column heading before screenshotting instead of racing it.
      await expect(kanbanHeading).toBeVisible();
      await expect(listAllChip).not.toBeVisible();
      await expect(page.getByText(order.order_number)).toBeVisible();
      await expect(page.getByRole("button", { name: "Kanban" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    // The toggle must still work in both directions regardless of which
    // one loaded first — the point of P11 is a smarter default, not a
    // narrower choice.
    const otherViewLabel = width < 768 ? "Kanban" : "Lis";
    await page.getByRole("button", { name: otherViewLabel, exact: true }).click();
    if (width < 768) {
      await expect(kanbanHeading).toBeVisible();
    } else {
      await expect(listAllChip).toBeVisible();
    }

    await page.screenshot({
      path: `test-results/screenshots/restaurant-orders-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
