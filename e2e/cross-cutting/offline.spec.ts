import { test, expect } from "@playwright/test";
import { mockSupabaseRoute } from "../support/mock-supabase";
import { restaurant } from "../fixtures/data";

test.describe("Offline — service worker fallback", () => {
  test("an unknown path still renders the app shell (client-side 404) instead of a browser network-error page while offline", async ({
    page,
    context,
  }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });

    // First visit online — lets the service worker install, activate,
    // and precache (workbox's __WB_MANIFEST list, including
    // /offline.html) before we ever go offline.
    await page.goto("/restaurants");
    await page.waitForFunction(
      async () => {
        if (!("serviceWorker" in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg?.active;
      },
      { timeout: 15_000 },
    );
    // Give workbox's install-time precaching a moment to actually finish
    // writing to the Cache Storage API after the SW reports "active".
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.goto("/some-route-never-visited-before", { waitUntil: "load" }).catch(() => {});

    // Once the SPA shell is precached, workbox's NavigationRoute serves
    // it for ANY navigation (including this made-up path) before the
    // client router itself renders its own 404 — genuinely correct PWA
    // behavior, and a stronger claim than merely showing "offline.html":
    // the app stays fully interactive offline rather than falling back
    // to a static interstitial. offline.html (setCatchHandler) is the
    // last-resort path for when even the precached shell can't be
    // found, which a context that already visited the site once (as
    // this test deliberately does, to let precaching finish) will not
    // hit — confirmed live rather than assumed.
    // The app's own 404 page (not a raw browser network-error
    // interstitial) renders — "Retounen lakay" is its own link text,
    // confirmed live.
    await expect(page.getByRole("link", { name: "Retounen lakay" })).toBeVisible({
      timeout: 10_000,
    });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/ERR_INTERNET_DISCONNECTED|can.t reach this page/i);
  });

  test("a previously-visited page still renders its shell while offline", async ({
    page,
    context,
  }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/restaurants");
    await page.waitForFunction(
      async () => {
        if (!("serviceWorker" in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg?.active;
      },
      { timeout: 15_000 },
    );
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.reload({ waitUntil: "load" }).catch(() => {});

    // The app shell (header/nav) is part of the precached bundle — even
    // if the (mocked) data fetch itself would fail offline, the static
    // shell should still paint rather than a browser network-error page.
    await expect(page.getByRole("link", { name: "Panye" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
