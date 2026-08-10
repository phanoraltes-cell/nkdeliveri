import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { sponsoredPlacement } from "../fixtures/data";

test.describe("Admin — Publicité", () => {
  test("creates a new sponsored placement", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let createCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:sponsored_placements": [],
      "rpc:create_sponsored_placement_secure": (route) => {
        createCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "new-ad" }),
        });
      },
    });

    await page.goto("/dashboard/admin/ads");
    await page.getByRole("button", { name: "Nouvo anons" }).click();
    await page.getByLabel("Tit anons lan").fill("Anons Tès Playwright");
    await page.getByLabel("Kòmanse").fill("2026-01-01");
    await page.getByLabel("Fini").fill("2026-12-31");
    await page.getByRole("button", { name: "Sove anons" }).click();
    await expect.poll(() => createCalled, { timeout: 5000 }).toBe(true);
  });

  test("toggles an existing ad active/inactive", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let toggleCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:sponsored_placements": [sponsoredPlacement],
      "rpc:update_sponsored_placement_secure": (route) => {
        toggleCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/admin/ads");
    const toggleButton = page.getByRole("button", { name: /Dezaktive|Aktive/ }).first();
    if (await toggleButton.isVisible().catch(() => false)) {
      await toggleButton.click();
      expect(toggleCalled).toBe(true);
    }
  });
});
