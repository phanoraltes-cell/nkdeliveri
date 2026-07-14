import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OrderIdSchema = z.object({ orderId: z.string().uuid() });

async function pushToUsers(
  userIds: string[],
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
    data?: Record<string, unknown>;
  },
) {
  if (userIds.length === 0) return { sent: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: subs, error: subsErr } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  // Push delivery is a best-effort side effect of an order/delivery state
  // change that has already been recorded — log rather than throw, so a
  // subscriptions lookup failure doesn't get mistaken for that change
  // itself failing.
  if (subsErr) console.error("[pushToUsers] failed to load subscriptions", subsErr);
  if (!subs || subs.length === 0) return { sent: 0 };

  const { buildPushPayload } = await import("@block65/webcrypto-web-push");
  const vapid = {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: JSON.parse(process.env.VAPID_PRIVATE_JWK!),
  };
  const message = {
    data: JSON.stringify(payload),
    options: { ttl: 60 * 60 * 24 },
  };

  let sent = 0;
  const deadEndpoints: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        // The web-push package's PushSubscription type carries expirationTime
        // (from the browser API) — the Supabase row never stores it, so it's
        // always null here, which the package treats the same as absent.
        const subscription = {
          endpoint: s.endpoint,
          expirationTime: null,
          keys: { p256dh: s.p256dh, auth: s.auth },
        };
        const built = await buildPushPayload(message, subscription, vapid);
        const res = await fetch(s.endpoint, built as unknown as RequestInit);
        if (res.status === 404 || res.status === 410) deadEndpoints.push(s.endpoint);
        else if (res.ok || res.status === 201) sent++;
      } catch (err) {
        console.warn("[push] send failed", err);
      }
    }),
  );
  if (deadEndpoints.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }
  return { sent };
}

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

    const { data: allowed, error: rlErr } = await context.supabase.rpc("check_rate_limit_secure", {
      _action: "send_new_order_push",
      _max_hits: 20,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) return { sent: 0, rateLimited: true };

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

    const { data: allowed, error: rlErr } = await context.supabase.rpc("check_rate_limit_secure", {
      _action: "send_delivery_assigned_push",
      _max_hits: 20,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) return { sent: 0, rateLimited: true };

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

    const { data: allowed, error: rlErr } = await context.supabase.rpc("check_rate_limit_secure", {
      _action: "send_order_delivered_push",
      _max_hits: 20,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) return { sent: 0, rateLimited: true };

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
