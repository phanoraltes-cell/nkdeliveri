import { test, expect } from "@playwright/test";
import { mockSupabaseRoute } from "../support/mock-supabase";
import { restaurant, product } from "../fixtures/data";
import { CART } from "../support/locators";

test.describe("Client — browse restaurants (public, no auth)", () => {
  test("restaurant list shows the fixture restaurant", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");
    await expect(page.getByText(restaurant.name)).toBeVisible();
  });

  test("restaurant detail page shows the menu and add-to-cart works", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:reviews": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto(`/restaurants/${restaurant.slug}`);
    await expect(page.getByRole("heading", { name: restaurant.name })).toBeVisible();
    await expect(page.getByText(product.name)).toBeVisible();

    const addButton = page.getByRole("button", { name: CART.addToCart(product.name) });
    await addButton.click();

    // Cart is client-side only (useCart) — confirm the header cart link
    // now reflects a non-empty cart rather than asserting on internal
    // state directly.
    await page.getByRole("link", { name: "Panye" }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByText(product.name).first()).toBeVisible();
  });
});
