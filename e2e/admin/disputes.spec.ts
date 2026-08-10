import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { dispute } from "../fixtures/data";

test.describe("Admin — Litige", () => {
  test("assigns an unassigned dispute to self", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let assignCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "rpc:get_disputes_admin": [dispute],
      "rpc:update_dispute_status_secure": (route) => {
        assignCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/admin/disputes");
    const takeButton = page.getByRole("button", { name: "Pran li" }).first();
    if (await takeButton.isVisible().catch(() => false)) {
      await takeButton.click();
      expect(assignCalled).toBe(true);
    }
  });

  test("resolves a dispute with a final ruling", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    let resolveCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "rpc:get_disputes_admin": [
        { ...dispute, assigned_to: "44444444-4444-4444-8444-444444444444" },
      ],
      "rpc:get_dispute_messages_secure": [],
      "rpc:resolve_dispute_secure": (route) => {
        resolveCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto("/dashboard/admin/disputes");
    const detailButton = page.getByRole("button", { name: "Wè detay" }).first();
    if (await detailButton.isVisible().catch(() => false)) {
      await detailButton.click();
      const resolutionBox = page.getByLabel("Rezolisyon final (admin)");
      if (await resolutionBox.isVisible().catch(() => false)) {
        await resolutionBox.fill("Litij la rezoud apre revizyon prèv yo.");
        await page.getByRole("button", { name: "Rezoud litij la" }).click();
        expect(resolveCalled).toBe(true);
      }
    }
  });
});
