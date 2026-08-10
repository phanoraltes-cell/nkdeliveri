import { test, expect } from "@playwright/test";
import { mockSupabaseRoute, registerHandlers, baseHandlersForRole } from "../support/mock-supabase";

test.describe("Auth — Créer compte (customer)", () => {
  test("registers a new customer account", async ({ page }) => {
    await mockSupabaseRoute(page, {
      ...registerHandlers("customer"),
      ...baseHandlersForRole("customer"),
    });

    await page.goto("/auth/register");
    await page
      .getByText(/Kliyan/)
      .first()
      .click();

    await page.getByLabel("Prenon").fill("Tès");
    await page.getByLabel("Non", { exact: true }).fill("Kliyan");
    await page.getByLabel("Email").fill("nouvo-kliyan@e2e.test");
    await page.getByLabel(/Telefòn/).fill("+509 4000 0000");
    await page.getByLabel("Modpas", { exact: true }).fill("password123");
    await page.getByLabel("Konfime modpas").fill("password123");
    await page.getByText("Mwen aksepte Kondisyon Itilizasyon").click();
    await page.getByRole("button", { name: "Kreye kont kliyan" }).click();

    await expect(page).toHaveURL(/\/(dashboard|auth)/);
  });

  test("rejects mismatched password confirmation client-side", async ({ page }) => {
    await mockSupabaseRoute(page, { ...registerHandlers("customer") });
    await page.goto("/auth/register");
    await page
      .getByText(/Kliyan/)
      .first()
      .click();

    await page.getByLabel("Prenon").fill("Tès");
    await page.getByLabel("Non", { exact: true }).fill("Kliyan");
    await page.getByLabel("Email").fill("nouvo-kliyan@e2e.test");
    await page.getByLabel(/Telefòn/).fill("+509 4000 0000");
    await page.getByLabel("Modpas", { exact: true }).fill("password123");
    await page.getByLabel("Konfime modpas").fill("different456");
    await page.getByText("Mwen aksepte Kondisyon Itilizasyon").click();
    await page.getByRole("button", { name: "Kreye kont kliyan" }).click();

    await expect(page.getByText("Modpas yo pa menm")).toBeVisible();
  });
});
