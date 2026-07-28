import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";

const OrderIdSchema = z.object({ orderId: z.string().uuid() });

/** Called right after create_order_secure succeeds — notifies the restaurant owner of a new order. */
export const sendNewOrderPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => OrderIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("order_number, customer_id, restaurants(owner_id, name)")
      .eq("id", data.orderId)
      .single();
    if (error || !order) throw new Error(error?.message || "Order not found");
    // Only the customer who placed it may trigger this notification.
    if (order.customer_id !== context.userId) throw new Error("Forbidden");

    if (!(await enforceRateLimit(context.supabase, "send_new_order_push", 20, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const ownerId = order.restaurants?.owner_id;
    if (!ownerId) return { sent: 0 };

    return pushToUsers([ownerId], {
      title: "Nouvo kòmand! 🛎️",
      body: `Kòmand ${order.order_number} fèk antre.`,
      url: `/dashboard/restaurant/orders`,
      tag: `new-order-${data.orderId}`,
      data: { orderId: data.orderId },
    });
  });

/** Called right after claim_delivery_secure succeeds — confirms the assignment to the driver. */
export const sendDeliveryAssignedPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => OrderIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: delivery, error } = await supabaseAdmin
      .from("deliveries")
      .select("driver_id, orders(order_number, delivery_address), drivers(user_id)")
      .eq("order_id", data.orderId)
      .single();
    if (error || !delivery) throw new Error(error?.message || "Delivery not found");
    const driverUserId = delivery.drivers?.user_id;
    if (!driverUserId || driverUserId !== context.userId) throw new Error("Forbidden");

    if (!(await enforceRateLimit(context.supabase, "send_delivery_assigned_push", 20, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const order = delivery.orders;
    return pushToUsers([driverUserId], {
      title: "Nouvo livrezon pou ou 🛵",
      body: `Kòmand ${order?.order_number ?? ""} — ${order?.delivery_address ?? ""}`,
      url: `/dashboard/driver`,
      tag: `assigned-${data.orderId}`,
      data: { orderId: data.orderId },
    });
  });

/** Called right after a driver marks a delivery "delivered" — notifies the customer. */
export const sendOrderDeliveredPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => OrderIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: delivery, error } = await supabaseAdmin
      .from("deliveries")
      .select("status, drivers(user_id), orders(order_number, customer_id)")
      .eq("order_id", data.orderId)
      .single();
    if (error || !delivery) throw new Error(error?.message || "Delivery not found");
    const driverUserId = delivery.drivers?.user_id;
    if (!driverUserId || driverUserId !== context.userId) throw new Error("Forbidden");
    if (delivery.status !== "delivered") return { sent: 0, skipped: true };

    if (!(await enforceRateLimit(context.supabase, "send_order_delivered_push", 20, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const order = delivery.orders;
    const customerId = order?.customer_id;
    if (!customerId) return { sent: 0 };

    return pushToUsers([customerId], {
      title: "Kòmand ou delivre! ✅",
      body: `Kòmand ${order?.order_number ?? ""} rive. Bon apeti!`,
      url: `/orders/${data.orderId}`,
      tag: `delivered-${data.orderId}`,
      data: { orderId: data.orderId },
    });
  });
