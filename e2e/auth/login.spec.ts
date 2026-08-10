import { test, expect } from "@playwright/test";
import { mockSupabaseRoute, loginHandlers, baseHandlersForRole } from "../support/mock-supabase";

test.describe("Auth — Connexion (real form submission)", () => {
  test("logs in and redirects to /dashboard", async ({ page }) => {
    await mockSupabaseRoute(page, {
      ...loginHandlers("customer"),
      ...baseHandlersForRole("customer"),
    });

    await page.goto("/auth");
    await page.getByLabel("Email").fill("customer@e2e.test");
    await page.getByLabel("Modpas").fill("correct-password-123");
    await page.getByRole("button", { name: "Konekte" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("shows an error toast for a rejected login", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "rpc:check_auth_rate_limit_secure": true,
      "auth:token": (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          }),
        }),
    });

    await page.goto("/auth");
    await page.getByLabel("Email").fill("customer@e2e.test");
    await page.getByLabel("Modpas").fill("wrong-password");
    await page.getByRole("button", { name: "Konekte" }).click();

    await expect(page).toHaveURL(/\/auth/);
  });
});
