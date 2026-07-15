import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ orderId: z.string().uuid() });

const STATUS_COPY: Record<string, { title: string; body: (orderNumber: string) => string }> = {
  confirmed: {
    title: "Kòmand ou konfime",
    body: (n) => `Restoran an konfime kòmand ${n}. Y ap kòmanse prepare l.`,
  },
  preparing: {
    title: "Y ap prepare kòmand ou",
    body: (n) => `Kòmand ${n} ap prepare kounye a.`,
  },
  ready: {
    title: "Kòmand ou prè",
    body: (n) => `Kòmand ${n} prè — l ap tann yon livrè.`,
  },
  cancelled: {
    title: "Kòmand anile",
    body: (n) => `Kòmand ${n} te anile.`,
  },
};

/** Called right after update_order_status_secure succeeds for a confirmed/preparing/ready/cancelled transition — notifies the customer. */
export const sendOrderStatusPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, customer_id")
      .eq("id", data.orderId)
      .single();
    if (error || !order) throw new Error(error?.message || "Order not found");

    const copy = STATUS_COPY[order.status];
    if (!copy) return { sent: 0, skipped: true };

    const { pushToUsers } = await import("@/lib/push-dispatch.server");
    return pushToUsers([order.customer_id], {
      title: copy.title,
      body: copy.body(order.order_number),
      url: `/orders/${order.id}`,
      tag: `order-status-${order.id}`,
      data: { orderId: order.id, status: order.status },
    });
  });
