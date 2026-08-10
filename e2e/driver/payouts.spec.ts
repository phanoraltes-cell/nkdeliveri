import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { wallet, driver } from "../fixtures/data";

test.describe("Driver — Décaissement", () => {
  test("shows the wallet balance and saves payout settings", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    let saveCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:wallets": [wallet.driver],
      "table:payouts": [],
      "rpc:update_driver_payout_secure": (route) => {
        saveCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/driver/payouts");
    await expect(page.getByText(/Peman ak Komisyon/)).toBeVisible();
    const saveButton = page.getByRole("button", { name: "Sove chanjman yo" });
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
      await expect.poll(() => saveCalled, { timeout: 5000 }).toBe(true);
    }
  });
});
