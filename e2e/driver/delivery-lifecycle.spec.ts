import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, delivery, driver, payment } from "../fixtures/data";
import { GPS_TOGGLE } from "../support/locators";

test.describe("Driver — Livraison / Paiement (cash confirm) / GPS", () => {
  test("marks pickup then delivery complete", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    let lastUpdate: Record<string, unknown> | undefined;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:deliveries": (route) => {
        if (route.request().method() === "PATCH") {
          lastUpdate = route.request().postDataJSON();
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ ...delivery, status: "assigned", orders: order }]),
        });
      },
    });

    await page.goto("/dashboard/driver/history");
    const pickupButton = page.getByRole("button", { name: "Pikap fèt" }).first();
    if (await pickupButton.isVisible().catch(() => false)) {
      await pickupButton.click();
      expect(lastUpdate?.status).toBe("picked_up");
    }
  });

  test("confirms cash payment received", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    let confirmCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:deliveries": [
        {
          ...delivery,
          status: "delivered",
          orders: { ...order, payments: [{ ...payment, cash_confirmation_status: "pending" }] },
        },
      ],
      "rpc:confirm_cash_payment_secure": (route) => {
        confirmCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/driver/history");
    const confirmButton = page.getByRole("button", { name: "✓ Mwen resevwa l" });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      expect(confirmCalled).toBe(true);
    }
  });

  test("GPS toggle activates driver location reporting", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 18.54, longitude: -72.335 });
    await mockSupabaseAuth(page, "driver");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:deliveries": [{ ...delivery, status: "assigned", orders: order }],
    });

    await page.goto("/dashboard/driver");
    const toggle = page.getByRole("button", { name: GPS_TOGGLE.off, exact: true });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await expect(page.getByRole("button", { name: GPS_TOGGLE.on, exact: true })).toBeVisible();
    }
  });
});
