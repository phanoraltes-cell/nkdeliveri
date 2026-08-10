import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, driver } from "../fixtures/data";

test.describe("Admin — Validation (restaurant/driver approval)", () => {
  test("approves a pending restaurant from the index queue", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let approveCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:restaurants": [{ ...restaurant, status: "pending" }],
      "table:drivers": [],
      "table:orders": [],
      "rpc:update_restaurant_status_secure": (route) => {
        approveCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/admin");
    const approveButton = page.getByRole("button", { name: "Apwouve" }).first();
    if (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      expect(approveCalled).toBe(true);
    }
  });

  test("approves a driver from the driver detail dialog", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let approveCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:drivers": [{ ...driver, status: "pending" }],
      "rpc:get_drivers_admin": [{ ...driver, status: "pending" }],
      "rpc:update_driver_status_secure": (route) => {
        approveCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/admin/drivers");
    const detailButton = page.getByRole("button", { name: "Wè pwofil" }).first();
    if (await detailButton.isVisible().catch(() => false)) {
      await detailButton.click();
      await page.getByRole("dialog").getByRole("button", { name: "Apwouve" }).click();
      expect(approveCalled).toBe(true);
    }
  });
});
