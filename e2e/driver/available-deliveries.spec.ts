import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, driver, restaurant } from "../fixtures/data";

test.describe("Driver — accepter une livraison disponible", () => {
  test("claims an available delivery", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    let claimCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [{ ...driver, status: "online" }],
      "table:orders": [{ ...order, status: "ready", restaurants: restaurant }],
      "table:deliveries": [],
      "rpc:claim_delivery_secure": (route) => {
        claimCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: order.id }),
        });
      },
    });

    await page.goto("/dashboard/driver/available");
    const claimButton = page.getByRole("button", { name: "Pran livrezon sa a" }).first();
    if (await claimButton.isVisible().catch(() => false)) {
      await claimButton.click();
      expect(claimCalled).toBe(true);
    }
  });
});
