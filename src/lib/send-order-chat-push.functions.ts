import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ orderId: z.string().uuid() });

/**
 * Called right after send_order_chat_message_secure succeeds — pushes to
 * every other party (customer, assigned driver, every admin — never the
 * restaurant), the same audience the RPC itself already notifies in-app
 * via private.notify_secure. Without this, a recipient who doesn't have
 * the chat thread open on screen has no way to learn a message arrived.
 */
export const sendOrderChatPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit_secure", {
      _action: "send_order_chat_push",
      _max_hits: 40,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) return { sent: 0, rateLimited: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, customer_id")
      .eq("id", data.orderId)
      .single();
    if (error || !order) throw new Error(error?.message || "Order not found");

    const { data: deliveries, error: delErr } = await supabaseAdmin
      .from("deliveries")
      .select("drivers(user_id)")
      .eq("order_id", data.orderId);
    if (delErr) throw new Error(delErr.message);

    const { data: admins, error: adminsErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    if (adminsErr) throw new Error(adminsErr.message);

    const parties = new Set<string>();
    if (order.customer_id) parties.add(order.customer_id);
    for (const d of deliveries ?? []) {
      if (d.drivers?.user_id) parties.add(d.drivers.user_id);
    }
    for (const a of admins ?? []) parties.add(a.user_id);
    parties.delete(userId);

    if (parties.size === 0) return { sent: 0 };

    const { pushToUsers } = await import("@/lib/push-dispatch.server");
    return pushToUsers(Array.from(parties), {
      title: "Nouvo mesaj",
      body: `Gen yon nouvo mesaj nan chat kòmand ${order.order_number}.`,
      url: `/orders/${order.id}`,
      tag: `order-chat-${order.id}`,
      data: { orderId: order.id },
    });
  });
