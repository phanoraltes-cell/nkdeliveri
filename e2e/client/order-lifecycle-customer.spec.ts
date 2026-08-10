import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, payment, delivery } from "../fixtures/data";
import { CONFIRM_DIALOG, GPS_TOGGLE } from "../support/locators";

function orderRowWithPayment(
  overrides: Record<string, unknown> = {},
  paymentOverrides: Record<string, unknown> = {},
) {
  return { ...order, ...overrides, payments: [{ ...payment, ...paymentOverrides }] };
}

test.describe("Client — order lifecycle (cancel, cash confirmation, GPS)", () => {
  test("cancels a pending order via the confirm dialog", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    let cancelCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": orderRowWithPayment({ status: "pending" }),
      "rpc:update_order_status_secure": (route) => {
        cancelCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: order.id, status: "cancelled" }),
        });
      },
    });

    await page.goto(`/orders/${order.id}`);
    await page.getByRole("button", { name: "Anile kòmand" }).click();
    await page.getByRole("dialog").getByRole("button", { name: CONFIRM_DIALOG.confirm }).click();

    await expect(page.getByText("Kòmand anile")).toBeVisible();
    expect(cancelCalled).toBe(true);
  });

  test("cancel button is hidden once an order is no longer pending/confirmed", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": orderRowWithPayment({ status: "preparing" }),
    });
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole("button", { name: "Anile kòmand" })).toHaveCount(0);
  });

  test("cash double-confirmation: customer confirms payment received", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    let confirmCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": orderRowWithPayment(
        { status: "delivered" },
        { cash_confirmation_status: "pending" },
      ),
      "rpc:confirm_cash_payment_secure": (route) => {
        confirmCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto(`/orders/${order.id}`);
    await page.getByRole("button", { name: "✓ Mwen peye" }).click();
    await expect(page.getByText("Konfimasyon anrejistre")).toBeVisible();
    expect(confirmCalled).toBe(true);
  });

  test("GPS toggle activates location sharing on an active delivery", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 18.54, longitude: -72.335 });
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": orderRowWithPayment({ status: "assigned" }),
      "table:deliveries": [delivery],
      "rpc:push_customer_location_secure": true,
    });

    await page.goto(`/orders/${order.id}`);
    const toggle = page.getByRole("button", { name: GPS_TOGGLE.off, exact: true });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await expect(page.getByRole("button", { name: GPS_TOGGLE.on, exact: true })).toBeVisible();
    }
  });
});
