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

    // Depi refont Tach 2 a, metòd peman yo se vre radyo (`role=radio`), pa
    // bouton. Nou verifye ETA SEMANTIK la (checked/disabled) olye klas CSS:
    // se sa yon lektè ekran wè, epi li pa kase chak fwa yon klas chanje.
    const moncashAuto = page.getByRole("radio", { name: /MonCash Otomatik/ });
    const natcashAuto = page.getByRole("radio", { name: /NatCash Otomatik/ });
    const cash = page.getByRole("radio", { name: /Kach nan livrezon/ });

    // Cash is the seeded default provider.
    await expect(cash).toBeChecked();

    // Both automatic methods show the "coming soon" message and are truly disabled.
    await expect(moncashAuto).toBeDisabled();
    await expect(page.getByText("MonCash Otomatik ap retounen byento.")).toBeVisible();
    await expect(natcashAuto).toBeDisabled();
    await expect(page.getByText("NatCash Otomatik ap retounen byento.")).toBeVisible();

    // Clicking them (even though disabled) must not change selection.
    await moncashAuto.check({ force: true }).catch(() => {});
    await expect(cash).toBeChecked();
    await natcashAuto.check({ force: true }).catch(() => {});
    await expect(cash).toBeChecked();

    // MonCash Manyèl and NatCash (manual) remain fully selectable. Each
    // radio's accessible name is its `aria-label` (label + sub-line, e.g.
    // "NatCash — Peman manyèl ak prèv"), so a plain `exact: true` match on
    // just "NatCash" never matches anything — a negative lookahead excludes
    // "NatCash Otomatik" without needing to know the exact sub-line text.
    const moncashManual = page.getByRole("radio", { name: /MonCash Manyèl/ });
    await moncashManual.check();
    await expect(moncashManual).toBeChecked();
    await expect(moncashManual).toBeEnabled();

    const natcashManual = page.getByRole("radio", { name: /^NatCash(?!\s*Otomatik)/ });
    await natcashManual.check();
    await expect(natcashManual).toBeChecked();
    await expect(natcashManual).toBeEnabled();
    await expect(moncashManual).not.toBeChecked();
  });
});
