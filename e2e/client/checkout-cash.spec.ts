import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, product, order, paymentProviderSettings } from "../fixtures/data";
import { rpcResponses } from "../fixtures/rpc-responses";

// "Kach nan livrezon" is the simplest full order+pay flow to mock (no
// redirect, no proof upload) — see the plan's rationale in
// docs/E2E_TEST_REPORT.md.
test.describe("Client — Commander / Payer (Kach)", () => {
  test("places a cash order end to end", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:addresses": [],
      "table:payment_provider_settings": paymentProviderSettings,
      "table:payments": [{ id: "60000000-0000-4000-8000-000000000002", order_id: order.id }],
      "rpc:create_order_secure": rpcResponses.create_order_secure,
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

    await page.locator("#checkout-address").fill(order.delivery_address);
    await page.locator("#checkout-phone").fill(order.contact_phone);
    await page.getByRole("button", { name: /Kach nan livrezon/ }).click();

    await page.getByRole("button", { name: /Konfime kòmand la/ }).click();

    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}`));
  });

  test("shows validation errors for missing address/phone without calling the RPC", async ({
    page,
  }) => {
    await mockSupabaseAuth(page, "customer");
    let createOrderCalled = false;
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
      "rpc:create_order_secure": () => {
        createOrderCalled = true;
      },
    });

    await page.goto(`/restaurants/${restaurant.slug}`);
    await page.getByRole("button", { name: `Ajoute ${product.name} nan panye` }).click();
    await page.goto("/checkout");
    await page.getByRole("button", { name: /Konfime kòmand la/ }).click();

    await expect(page.getByText("Antre adrès livrezon w")).toBeVisible();
    expect(createOrderCalled).toBe(false);
  });
});
