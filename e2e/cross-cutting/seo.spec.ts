import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { restaurant, product, order } from "../fixtures/data";

// Canonical/og:url always read the hardcoded production SITE_URL
// (src/lib/site-config.ts) regardless of the local test origin — assert
// against that literal, not the local baseURL.
const SITE_URL = "https://www.nkdeliveri.com";

test.describe("SEO — public pages indexable, private pages not", () => {
  test("home page has title/description/canonical/OG tags", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:products": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    // absoluteUrl("/") does not append a trailing slash — confirmed live.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", SITE_URL);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  });

  test("restaurant detail page has a canonical URL matching its slug", async ({ page }) => {
    await mockSupabaseRoute(page, {
      "table:restaurants": [restaurant],
      "table:menu_categories": [],
      "table:products": [product],
      "table:reviews": [],
      "rpc:get_active_placements_secure": [],
    });
    await page.goto(`/restaurants/${restaurant.slug}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE_URL}/restaurants/${restaurant.slug}`,
    );
  });

  test("dashboard pages are noindex", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, { ...baseHandlersForRole("customer"), "table:orders": [order] });
    await page.goto("/dashboard/customer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  test("robots.txt is served", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toContain("User-agent");
    expect(body.toLowerCase()).toContain("sitemap");
  });

  test("sitemap.xml is well-formed and includes the fixture restaurant", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain(`/restaurants/${restaurant.slug}`);
  });
});
