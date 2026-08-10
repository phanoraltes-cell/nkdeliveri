import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { notification } from "../fixtures/data";
import { NOTIFICATIONS_TABS } from "../support/locators";

test.describe("Notifications (shared page, tested from customer context)", () => {
  test("lists a notification and shows every category tab", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:notifications": [notification],
    });

    await page.goto("/notifications");
    await expect(page.getByText(notification.title)).toBeVisible();
    for (const tab of NOTIFICATIONS_TABS) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }
  });

  test("marks a notification as read", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    let updateBody: unknown;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:notifications": (route) => {
        if (route.request().method() === "PATCH") {
          updateBody = route.request().postDataJSON();
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([notification]),
        });
      },
    });

    await page.goto("/notifications");
    await page.getByRole("button", { name: "Li", exact: true }).first().click();
    expect(updateBody).toBeTruthy();
  });
});
