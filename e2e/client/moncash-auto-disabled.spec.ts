import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, product, paymentProviderSettings } from "../fixtures/data";

test.describe("Checkout — MonCash Otomatik / NatCash Otomatik temporarily disabled", () => {
  test("Cash is selected by default, both automatic methods are disabled with badge and cannot be selected", async ({
    page,
  }) => {
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

    const moncashAutoButton = page.getByRole("button", { name: /MonCash Otomatik/ });
    const natcashAutoButton = page.getByRole("button", { name: /NatCash Otomatik/ });
    const cashButton = page.getByRole("button", { name: /Kach nan livrezon/ });

    // Cash is selected by default (border-brand + bg-brand-soft class combo).
    await expect(cashButton).toHaveClass(/border-brand bg-brand-soft/);

    // Both automatic methods show the "coming soon" badge and are truly disabled.
    await expect(moncashAutoButton).toContainText("Byento disponib");
    await expect(moncashAutoButton).toContainText("MonCash Otomatik ap retounen byento.");
    await expect(moncashAutoButton).toBeDisabled();

    await expect(natcashAutoButton).toContainText("Byento disponib");
    await expect(natcashAutoButton).toContainText("NatCash Otomatik ap retounen byento.");
    await expect(natcashAutoButton).toBeDisabled();

    // Clicking them (even though disabled) must not change selection.
    await moncashAutoButton.click({ force: true }).catch(() => {});
    await expect(cashButton).toHaveClass(/border-brand bg-brand-soft/);
    await natcashAutoButton.click({ force: true }).catch(() => {});
    await expect(cashButton).toHaveClass(/border-brand bg-brand-soft/);

    // MonCash Manyèl and NatCash (manual) remain fully selectable. Each
    // button's accessible name is its full text content (label + sub-line,
    // e.g. "NatCash Peman manyèl ak prèv"), so a plain `exact: true` match
    // on just "NatCash" never matches anything — a negative lookahead
    // excludes "NatCash Otomatik" (whose name continues with "Otomatik ...")
    // without needing to know the exact sub-line text.
    const moncashManualButton = page.getByRole("button", { name: /MonCash Manyèl/ });
    await moncashManualButton.click();
    await expect(moncashManualButton).toHaveClass(/border-brand bg-brand-soft/);
    await expect(moncashManualButton).toBeEnabled();

    const natcashManualButton = page.getByRole("button", { name: /^NatCash(?!\s*Otomatik)/ });
    await natcashManualButton.click();
    await expect(natcashManualButton).toHaveClass(/border-brand bg-brand-soft/);
    await expect(natcashManualButton).toBeEnabled();
  });
});
