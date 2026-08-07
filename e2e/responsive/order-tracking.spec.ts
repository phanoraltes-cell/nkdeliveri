import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order, payment, delivery, driver } from "../fixtures/data";

// Refonte Frontend Premium, Phase 6 (P6) — /orders/$id had no responsive
// coverage before this file even though it was the subject of the Phase 2
// restructuring (timeline + contextual banner + "Detay ak sipò"
// accordion). Added here, not to e2e/client/, specifically to re-run
// across viewports: this exact gap is what let the "Anile kòmand" button
// ship hidden inside the collapsed accordion for pending orders — caught
// by re-running e2e/client/order-lifecycle-customer.spec.ts during this
// phase, fixed in orders.$id.tsx, and now guarded here too so a future
// change can't silently reopen the same hole.
test.describe("Responsive — order tracking timeline", () => {
  test("pending order: cancel action is reachable without opening the accordion", async ({
    page,
  }, testInfo) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "pending", payments: [payment] },
      "table:disputes": [],
    });

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByRole("button", { name: "Anile kòmand" })).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/order-pending-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test("delivered order: accordion is open by default, review is reachable", async ({
    page,
  }, testInfo) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": {
        ...order,
        status: "delivered",
        payments: [{ ...payment, status: "paid", cash_confirmation_status: "validated" }],
      },
      "table:disputes": [],
      "table:reviews": [],
    });

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText("Bay avi w")).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/order-delivered-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test("active delivery: tracking map and driver info render", async ({ page }, testInfo) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "assigned", payments: [payment] },
      "table:deliveries": [{ ...delivery, drivers: driver }],
      "table:disputes": [],
    });

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByText("Swiv livrezon w")).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/order-tracking-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
