import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";

test.describe("Admin — chat", () => {
  test("loads the admin support chat center", async ({ page }) => {
    await mockSupabaseAuth(page, "admin");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("admin"),
      "table:order_chat_messages": [],
    });
    await page.goto("/dashboard/admin/chat");
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  });
});
