import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, payment, driver } from "../fixtures/data";
import { REVIEW } from "../support/locators";

test.describe("Client — Noter (order review)", () => {
  test("submits a restaurant + driver rating on a delivered order", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    let reviewInsertBody: unknown;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": {
        ...order,
        status: "delivered",
        driver_id: driver.id,
        payments: [payment],
      },
      "table:reviews": (route) => {
        if (route.request().method() === "POST") {
          reviewInsertBody = route.request().postDataJSON();
          return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      },
    });

    await page.goto(`/orders/${order.id}`);
    await page
      .getByRole("button", { name: REVIEW.star(4) })
      .first()
      .click();
    await page.getByRole("button", { name: "Voye avi" }).click();

    await expect(page.getByText("Mèsi pou avi w!")).toBeVisible();
    expect(reviewInsertBody).toBeTruthy();
  });

  test("shows a validation error when no restaurant rating is given", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "delivered", payments: [payment] },
      "table:reviews": [],
    });
    await page.goto(`/orders/${order.id}`);
    await page.getByRole("button", { name: "Voye avi" }).click();
    await expect(page.getByText("Bay yon nòt pou restoran an")).toBeVisible();
  });
});
