import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { driver } from "../fixtures/data";

test.describe("Driver — chat", () => {
  test("loads the driver chat center", async ({ page }) => {
    await mockSupabaseAuth(page, "driver");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("driver"),
      "table:drivers": [driver],
      "table:order_chat_messages": [],
    });
    await page.goto("/dashboard/driver/chat");
    await expect(page).toHaveURL(/\/dashboard\/driver\/chat/);
  });
});
