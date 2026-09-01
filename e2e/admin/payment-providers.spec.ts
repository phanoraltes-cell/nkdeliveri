import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { paymentProviderSettings } from "../fixtures/data";

// Adds `id`/`updated_at` — the admin page selects more columns than the
// checkout-facing fixture (payment-provider-availability.ts's
// fetchPaymentProviderSettings) needs, see
// dashboard.admin.payment-providers.tsx's own comment for why. Order
// matches paymentProviderSettings exactly (kach, moncash, natcash,
// moncash_auto, natcash_auto) — the mock harness returns table rows in
// the order given here regardless of any `.order()` call in the real
// query, so the rendered card order is deterministic and known.
const adminProviderRows = paymentProviderSettings.map((s, i) => ({
  id: `70000000-0000-4000-8000-00000000000${i}`,
  ...s,
  updated_at: "2026-08-01T00:00:00Z",
}));
const KACH_INDEX = 0;
const MONCASH_AUTO_INDEX = 3;
const NATCASH_AUTO_INDEX = 4;

test.describe("Admin — Fournisseurs (payment provider availability)", () => {
  test("lists all 5 methods with their current visible/enabled/default state", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": adminProviderRows,
    });

    await page.goto("/dashboard/admin/payment-providers");

    await expect(page.getByRole("heading", { name: "Fournisseurs" })).toBeVisible();
    await expect(page.getByText("Kach nan livrezon")).toBeVisible();
    await expect(page.getByText("MonCash Manyèl")).toBeVisible();
    await expect(page.getByText("NatCash", { exact: true })).toBeVisible();
    await expect(page.getByText("MonCash Otomatik")).toBeVisible();
    await expect(page.getByText("NatCash Otomatik")).toBeVisible();

    // Cash is the seeded default; moncash_auto and natcash_auto are both
    // seeded disabled — both should render a "Dezaktive" status badge.
    // Badges use Tailwind's rounded-full (Badge component); the toggle
    // buttons that share the same label text ("Fè l default",
    // "Dezaktive") use rounded-lg — the one reliable way to tell the
    // status badge apart from an action button with overlapping text,
    // short of adding a test id this codebase deliberately doesn't use
    // anywhere.
    await expect(page.locator(".rounded-full", { hasText: "Default" })).toBeVisible();
    await expect(page.locator(".rounded-full", { hasText: "Dezaktive" })).toHaveCount(2);
  });

  test("enabling MonCash Otomatik calls the RPC with the right parameters, without touching NatCash Otomatik's own row", async ({
    page,
  }) => {
    await mockSupabaseAuth(page, "admin");
    let rpcArgs: unknown;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": adminProviderRows,
      "rpc:update_payment_provider_setting_secure": (route) => {
        rpcArgs = route.request().postDataJSON();
        const updated = { ...adminProviderRows[MONCASH_AUTO_INDEX], enabled: true };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(updated),
        });
      },
    });

    await page.goto("/dashboard/admin/payment-providers");

    // Both moncash_auto and natcash_auto are seeded disabled, so each has
    // its own "Aktive" button — scope to the MonCash Otomatik card
    // specifically (docs/archive/plop/PLOP_NATCASH_INTEGRATION_PLAN.md: the two
    // methods are independently gated, so this test must click the right
    // one, not just "the first Aktive button it finds").
    const moncashAutoCard = page.locator(".rounded-2xl", {
      has: page.getByRole("heading", { name: "MonCash Otomatik" }),
    });
    await moncashAutoCard.getByRole("button", { name: "Aktive", exact: true }).click();

    await expect
      .poll(() => rpcArgs)
      .toMatchObject({
        _provider: "moncash_auto",
        _enabled: true,
      });
  });

  test("enabling NatCash Otomatik calls the RPC with _provider:'natcash_auto', independently of MonCash Otomatik", async ({
    page,
  }) => {
    await mockSupabaseAuth(page, "admin");
    let rpcArgs: unknown;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": adminProviderRows,
      "rpc:update_payment_provider_setting_secure": (route) => {
        rpcArgs = route.request().postDataJSON();
        const updated = { ...adminProviderRows[NATCASH_AUTO_INDEX], enabled: true };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(updated),
        });
      },
    });

    await page.goto("/dashboard/admin/payment-providers");

    const natcashAutoCard = page.locator(".rounded-2xl", {
      has: page.getByRole("heading", { name: "NatCash Otomatik" }),
    });
    await natcashAutoCard.getByRole("button", { name: "Aktive", exact: true }).click();

    await expect
      .poll(() => rpcArgs)
      .toMatchObject({
        _provider: "natcash_auto",
        _enabled: true,
      });
  });

  test('the current default provider\'s "Fè l default" button is disabled, others are not', async ({
    page,
  }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": adminProviderRows,
    });

    await page.goto("/dashboard/admin/payment-providers");

    const defaultButtons = page.getByRole("button", { name: "Fè l default" });
    await expect(defaultButtons).toHaveCount(5);
    await expect(defaultButtons.nth(KACH_INDEX)).toBeDisabled();
    await expect(defaultButtons.nth(MONCASH_AUTO_INDEX)).toBeEnabled();
    await expect(defaultButtons.nth(NATCASH_AUTO_INDEX)).toBeEnabled();
  });
});
