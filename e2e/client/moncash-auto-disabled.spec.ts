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
      // De nimewo yo konfigire: metòd manyèl fizyone a dwe montre TOUDE.
      "rpc:get_platform_payout_public": {
        moncash_number: "50912345678",
        moncash_account_name: "NK Deliveri",
        natcash_number: "50987654321",
        natcash_account_name: "NK Deliveri",
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

    // Depi fizyon 2026-09, de metòd manyèl yo se YON SÈL radyo ki kouvri
    // MonCash ak NatCash. Non aksesib li se  la (etikèt +
    // sou-liy), donk yon match sou etikèt la ase.
    const manual = page.getByRole("radio", { name: /MonCash oswa NatCash/ });
    await manual.check();
    await expect(manual).toBeChecked();
    await expect(manual).toBeEnabled();
    await expect(cash).not.toBeChecked();

    // Epi li montre TOUDE nimewo yo, se tout rezon fizyon an.
    await expect(page.getByText(/MonCash 509/)).toBeVisible();
    await expect(page.getByText(/NatCash 509/)).toBeVisible();
  });
});
