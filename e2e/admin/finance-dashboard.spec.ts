import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";

test.describe("Admin — Monitoring (index + Tablo Finansye)", () => {
  test("loads the admin index dashboard (monitoring)", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:restaurants": [],
      "table:drivers": [],
      "table:orders": [],
    });
    await page.goto("/dashboard/admin");
    await expect(page.getByRole("heading", { name: "Dashboard Administratè" })).toBeVisible();
  });

  test("loads the Tablo Finansye and switches tabs", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "rpc:get_admin_finance_overview_secure": [
        {
          total_commissions: 0,
          commissions_pending: 0,
          commissions_paid: 0,
          amount_to_disburse: 0,
          payouts_today: 0,
          payouts_this_week: 0,
          payouts_this_month: 0,
          restaurants_paid_count: 0,
          drivers_paid_count: 0,
          moncash_volume: 0,
          cash_volume: 0,
          natcash_volume: 0,
        },
      ],
      "rpc:get_admin_finance_history_secure": [],
    });

    await page.goto("/dashboard/admin/finance");
    await expect(page.getByRole("heading", { name: "Tablo Finansye" })).toBeVisible();
    await page.getByRole("button", { name: "Istorik" }).click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/finance/);
  });
});
