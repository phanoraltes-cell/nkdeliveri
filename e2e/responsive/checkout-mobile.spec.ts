import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, product, paymentProviderSettings } from "../fixtures/data";

test.describe("Responsive — checkout form usability", () => {
  test("checkout form fields and payment methods are all reachable", async ({ page }, testInfo) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:addresses": [],
      "table:payment_provider_settings": paymentProviderSettings,
      "rpc:get_platform_payout_public": {
        moncash_number: null,
        moncash_account_name: null,
        natcash_number: null,
        natcash_account_name: null,
      },
    });

    await page.goto(`/restaurants/${restaurant.slug}`);
    await page.getByRole("button", { name: `Ajoute ${product.name} nan panye` }).click();
    await page.goto("/checkout");

    await expect(page.locator("#checkout-address")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Kach nan livrezon/ })).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/checkout-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
