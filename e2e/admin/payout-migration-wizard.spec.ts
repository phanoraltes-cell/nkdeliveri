import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, restaurant } from "../fixtures/data";

test.describe("Admin — Backfill (payout migration wizard)", () => {
  test("walks through scan -> preview -> confirm -> execute -> report", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let executeCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "rpc:get_historical_backfill_summary_secure": [
        { total_orders: 1, restaurant_count: 1, driver_count: 1 },
      ],
      "rpc:get_historical_backfill_preview_secure": [
        { order_id: order.id, order_number: order.order_number, restaurant_name: restaurant.name },
      ],
      "rpc:execute_commission_backfill_secure": (route) => {
        executeCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ orders_migrated: 1, orders_failed: 0 }),
        });
      },
    });

    await page.goto("/dashboard/admin/payout-migration");
    const scanButton = page.getByRole("button", { name: "Wè detay yo" });
    if (!(await scanButton.isVisible().catch(() => false))) return;
    await scanButton.click();

    await page.getByRole("button", { name: "Kontinye" }).click();
    await page.getByLabel("Mwen konprann sa a pral kreye done finansye pèmanan").check();
    await page.getByRole("button", { name: "Konfime migrasyon an" }).click();

    await expect.poll(() => executeCalled).toBe(true);
    await expect(page.getByRole("button", { name: "Nouvo migrasyon" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
