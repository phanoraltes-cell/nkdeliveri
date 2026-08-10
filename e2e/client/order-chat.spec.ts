import { test, expect } from "@playwright/test";
import { mockSupabaseAuth, mockSupabaseRoute, baseHandlersForRole } from "../support/mock-supabase";
import { order } from "../fixtures/data";

test.describe("Client — order chat", () => {
  test("sends a message in the order chat thread", async ({ page }) => {
    await mockSupabaseAuth(page, "customer");
    let sendCalled = false;
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "confirmed" },
      "table:order_chat_messages": [],
      "rpc:mark_order_chat_read_secure": true,
      "rpc:send_order_chat_message_secure": (route) => {
        sendCalled = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      },
    });

    await page.goto(`/dashboard/customer/chat?order=${order.id}`);
    const input = page.getByLabel("Ekri yon mesaj…");
    await input.fill("Bonjou, ki lè kòmand la ap rive?");
    await page.getByRole("button", { name: "Voye", exact: true }).click();

    expect(sendCalled).toBe(true);
  });

  test("shows the closed-chat notice once the order reaches a terminal status", async ({
    page,
  }) => {
    await mockSupabaseAuth(page, "customer");
    await mockSupabaseRoute(page, {
      ...baseHandlersForRole("customer"),
      "table:orders": { ...order, status: "delivered" },
      "table:order_chat_messages": [],
      "rpc:mark_order_chat_read_secure": true,
    });
    await page.goto(`/dashboard/customer/chat?order=${order.id}`);
    await expect(page.getByText("Chat la fèmen — li rete disponib kòm istorik.")).toBeVisible();
  });
});
