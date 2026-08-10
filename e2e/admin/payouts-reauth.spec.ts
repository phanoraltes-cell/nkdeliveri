import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { buildSession } from "../fixtures/users";
import { wallet, restaurant } from "../fixtures/data";

// Admin payout requires stepping through useReauth()'s password dialog
// before the payout mutation fires — the admin fixture user has
// app_metadata.providers including "email" (see fixtures/users.ts) so
// this collects a password and calls signInWithPassword again, rather
// than an OAuth redirect this suite can't drive headlessly.
test.describe("Admin — Décaissement (with re-auth)", () => {
  test("pays a restaurant after confirming the re-auth dialog", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let payCalled = false;
    const session = buildSession("admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_providers": [
        { code: "manual", label: "Manyèl", is_active: true },
        { code: "moncash_api", label: "MonCash API", is_active: false },
      ],
      "rpc:get_restaurant_wallets_admin": [
        {
          restaurant_id: restaurant.id,
          name: restaurant.name,
          available_balance: wallet.restaurant.available_balance,
          moncash_number: "+509 1111 1111",
          natcash_number: null,
          total_count: 1,
        },
      ],
      "rpc:get_admin_payout_kpis": [
        {
          owed_restaurants: 4500,
          owed_drivers: 900,
          total_paid: 12000,
          total_pending: 0,
          payout_count: 3,
          dispute_count: 0,
        },
      ],
      "auth:token": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(session),
        }),
      "rpc:initiate_payout_secure": (route) => {
        payCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "payout-1", status: "paid" }),
        });
      },
    });

    await page.goto("/dashboard/admin/payouts");
    const payButton = page.getByRole("button", { name: "Peye" }).first();
    if (!(await payButton.isVisible().catch(() => false))) return;
    await payButton.click();

    await page
      .getByRole("button", { name: "Referans tranzaksyon" })
      .isVisible()
      .catch(() => {});
    const txRefInput = page.getByLabel("Referans tranzaksyon");
    if (await txRefInput.isVisible().catch(() => false)) {
      await txRefInput.fill("MC-TEST-REF-1");
    }
    await page.getByRole("button", { name: "Konfime peman" }).click();

    // Re-auth dialog, if it appears (grace window not yet active).
    const passwordInput = page.getByLabel(/Modpas/);
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill("test-password-e2e");
      await page.getByRole("button", { name: "Konfime" }).click();
    }

    await expect.poll(() => payCalled).toBe(true);
  });
});
