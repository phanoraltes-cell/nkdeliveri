import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, restaurant } from "../fixtures/data";

function orderRow(status: string) {
  return {
    ...order,
    status,
    restaurants: restaurant,
    payments: [{ method: "kach", status: "pending" }],
  };
}

test.describe("Restaurant — order Kanban lifecycle", () => {
  test("confirms a pending order (Konfime)", async ({ page }) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    let statusCalled: string | undefined;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:orders": [orderRow("pending")],
      "table:restaurants": [restaurant],
      "rpc:update_order_status_secure": (route) => {
        statusCalled = route.request().postDataJSON()?._new_status;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: order.id, status: statusCalled }),
        });
      },
    });

    await page.goto("/dashboard/restaurant/orders");
    await page.getByRole("button", { name: "Konfime" }).first().click();
    expect(statusCalled).toBe("confirmed");
  });

  test("moves a confirmed order to preparing then ready", async ({ page }) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    let statusCalled: string | undefined;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:orders": [orderRow("confirmed")],
      "table:restaurants": [restaurant],
      "rpc:update_order_status_secure": (route) => {
        statusCalled = route.request().postDataJSON()?._new_status;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: order.id, status: statusCalled }),
        });
      },
    });

    await page.goto("/dashboard/restaurant/orders");
    // The Kanban view (default) uses a generic "Avanse" button for every
    // forward transition; "Kòmanse prepare" is list-view-specific text.
    await page
      .getByRole("button", { name: /Avanse|Kòmanse prepare/ })
      .first()
      .click();
    expect(statusCalled).toBe("preparing");
  });
});
