import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";

test.describe("Admin — Collect payment monitoring (read-only)", () => {
  test("loads the Collect monitoring page on the MonCash tab by default", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": [],
      "table:payment_transactions": [],
      "table:plop_api_logs": [],
      "table:stripe_api_logs": [],
    });

    await page.goto("/dashboard/admin/collect");
    await expect(page.getByRole("heading", { name: "Peman Otomatik", exact: true })).toBeVisible();
    await expect(page.getByText("Peman total nan istwa a")).toBeVisible();
  });

  test("switches to the Kat Kredi (Stripe) tab", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:payment_provider_settings": [],
      "table:payment_transactions": [],
      "table:plop_api_logs": [],
      "table:stripe_api_logs": [],
    });

    await page.goto("/dashboard/admin/collect");
    await expect(page.getByRole("heading", { name: "Peman Otomatik", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Kat Kredi", exact: true }).click();
    await expect(page.getByText("Peman total nan istwa a")).toBeVisible();
  });
});
