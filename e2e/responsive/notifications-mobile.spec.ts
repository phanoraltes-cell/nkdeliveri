import { test, expect, type Locator } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { notification } from "../fixtures/data";

function overlaps(a: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>, b: typeof a) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// P12 (F header P2) — guards the actual regression found by the P11-style
// audit (docs/NOTIFICATIONS_PAGE_AUDIT.md): the header row used to have no
// flex-wrap, so PushToggle's wider states (the "permission denied" help
// card, or the "unsupported browser" message — both much wider than its
// usual compact button) overlapped the "Notifikasyon" title on every
// standard mobile width. Re-run across every responsive device project
// (Pixel 7, iPhone 13, iPad Mini, Desktop Chrome — see playwright.config.ts)
// specifically because the bug was width-dependent, not device-specific.
//
// Which of the two wide states actually renders depends on the browser
// engine, not on this test: WebKit's Playwright build doesn't expose the
// Push API the way Chromium does, so isPushSupported() correctly reports
// "unsupported" there instead of "denied" — asserted on directly below
// rather than forced, so the test reflects each engine's real behavior
// instead of assuming one specific state everywhere.
test.describe("Responsive — notifications page header (wide PushToggle states)", () => {
  test("title and PushToggle never overlap, whichever state renders", async ({
    page,
  }, testInfo) => {
    // Best-effort nudge toward the "denied" branch on engines that support
    // it (Chromium) — never required for the test to be meaningful, since
    // the assertions below check whichever state actually shows up.
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.Notification, "permission", {
          value: "denied",
          configurable: true,
        });
      } catch {
        // Notification API not present/writable in this engine.
      }
    });
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:notifications": [notification],
      "table:notification_preferences": [],
    });

    await page.goto("/notifications");
    const heading = page.getByRole("heading", { name: "Notifikasyon" });
    // Real rendered content, not just the URL.
    await expect(heading).toBeVisible();

    // NotificationPermissionDeniedHelp's root div has role="status" but no
    // aria-label/aria-labelledby, so it has no computed accessible *name*
    // (role="status" is "Name from: author" per the ARIA spec, not
    // content) — getByRole(..., { name }) would never match it. Locate
    // structurally instead, anchored on each branch's own visible text.
    const deniedCard = page.locator('[role="status"]').filter({ hasText: "Notifikasyon bloke" });
    const unsupportedBox = page.getByText("Navigatè sa a pa sipòte notifikasyon push.");
    const wideBlock = (await deniedCard.count()) > 0 ? deniedCard : unsupportedBox;
    await expect(wideBlock).toBeVisible();

    const headingBox = await heading.boundingBox();
    const wideBox = await wideBlock.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(wideBox).not.toBeNull();

    // Axis-aligned rectangle intersection test. flex-wrap can legally
    // place the wide block either beside the title (no Y overlap needed)
    // or below it (no X overlap needed); either is fine, only an actual
    // 2D overlap is the regression.
    expect(overlaps(headingBox!, wideBox!)).toBe(false);

    await page.screenshot({
      path: `test-results/screenshots/notifications-denied-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
});
