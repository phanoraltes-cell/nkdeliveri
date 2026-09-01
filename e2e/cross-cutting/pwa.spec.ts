import { test, expect } from "@playwright/test";
import { mockSupabaseRoute } from "../support/mock-supabase";
import { restaurant } from "../fixtures/data";

test.describe("PWA — manifest and service worker", () => {
  test("manifest.webmanifest is served with the expected required fields", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBe("NK Deliveri — Gonaïves");
    expect(manifest.short_name).toBe("NK Deliveri");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#F97316");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test("service worker registers on a production-mode build", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");

    const registration = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return null;
      // Give the browser a moment to finish registering (registerPWA()
      // runs once on load, only in a PROD build — see docs/reference/PWA.md).
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? { scope: reg.scope, active: !!reg.active } : null;
    });

    expect(registration).not.toBeNull();
  });

  test("beforeinstallprompt is handled without throwing", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/restaurants");
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      window.dispatchEvent(event);
    });
    await page.waitForTimeout(300);
    expect(pageErrors).toEqual([]);
  });
});
