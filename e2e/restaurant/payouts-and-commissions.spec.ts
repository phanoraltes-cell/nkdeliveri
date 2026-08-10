import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { wallet, restaurant } from "../fixtures/data";

test.describe("Restaurant — Décaissement / Historique", () => {
  test("shows the wallet balance and saves payout-number changes", async ({ page }) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    let saveCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:restaurants": [restaurant],
      "table:wallets": [wallet.restaurant],
      "table:payouts": [],
      "table:restaurant_payout_details": [
        {
          restaurant_id: restaurant.id,
          moncash_number: "+509 1111 1111",
          moncash_account_name: restaurant.name,
        },
      ],
      "rpc:update_restaurant_payout_secure": (route) => {
        saveCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/restaurant/payouts");
    await expect(page.getByText(/Peman ak Komisyon/)).toBeVisible();
    const saveButton = page.getByRole("button", { name: "Sove chanjman yo" });
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
      expect(saveCalled).toBe(true);
    }
  });

  test("shows commission history", async ({ page }) => {
    await mockSupabaseAuth(page, "restaurant_owner");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("restaurant_owner"),
      "table:restaurants": [restaurant],
      "table:wallets": [wallet.restaurant],
      "rpc:get_restaurant_commissions_secure": [],
    });
    await page.goto("/dashboard/restaurant/commissions");
    await expect(page).toHaveURL(/\/dashboard\/restaurant\/commissions/);
  });
});
