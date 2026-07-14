import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ paymentId: z.string().uuid() });

export const sendPaymentReviewPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Only admins may trigger sends
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit_secure", {
      _action: "send_payment_review_push",
      _max_hits: 30,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) throw new Error("Twòp notifikasyon nan yon ti tan. Tanpri eseye ankò pita.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payment, error: pErr } = await supabaseAdmin
      .from("payments")
      .select("id, status, order_id, review_notes, orders(order_number, customer_id, restaurants(owner_id, name))")
      .eq("id", data.paymentId)
      .single();
    if (pErr || !payment) throw new Error(pErr?.message || "Payment not found");

    const order = payment.orders;
    if (!order) throw new Error("Order not found");

    const status = payment.status as string;
    const orderNumber = order.order_number as string;

    let title = "";
    let body = "";
    if (status === "paid") {
      title = "Peman ou apwouve ✅";
      body = `Peman kòmand ${orderNumber} apwouve. Restoran an ap prepare li.`;
    } else if (status === "failed") {
      title = "Peman ou rejte ❌";
      body = `Peman kòmand ${orderNumber} rejte. ${
        payment.review_notes ? "Rezon: " + payment.review_notes : "Tanpri voye yon nouvo prèv."
      }`;
    } else {
      return { sent: 0, skipped: true };
    }

    const url = `/orders/${payment.order_id}`;
    const recipients = new Set<string>();
    if (order.customer_id) recipients.add(order.customer_id as string);
    if (order.restaurants?.owner_id) recipients.add(order.restaurants.owner_id as string);

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .in("user_id", Array.from(recipients));

    if (!subs || subs.length === 0) return { sent: 0 };

    const { buildPushPayload } = await import("@block65/webcrypto-web-push");

    const vapid = {
      subject: process.env.VAPID_SUBJECT!,
      publicKey: process.env.VAPID_PUBLIC_KEY!,
      privateKey: JSON.parse(process.env.VAPID_PRIVATE_JWK!),
    };

    const message = {
      data: JSON.stringify({
        title,
        body,
        url,
        tag: `payment-${payment.id}`,
        data: { paymentId: payment.id, orderId: payment.order_id },
      }),
      options: { ttl: 60 * 60 * 24 },
    };

    let sent = 0;
    const deadEndpoints: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          // expirationTime comes from the browser Push API and is never
          // stored on the Supabase row, so it's always null here — the
          // package treats that the same as absent.
          const subscription = {
            endpoint: s.endpoint,
            expirationTime: null,
            keys: { p256dh: s.p256dh, auth: s.auth },
          };
          const payload = await buildPushPayload(message, subscription, vapid);
          const res = await fetch(s.endpoint, payload as unknown as RequestInit);
          if (res.status === 404 || res.status === 410) {
            deadEndpoints.push(s.endpoint);
          } else if (res.ok || res.status === 201) {
            sent++;
          }
        } catch (err) {
          console.warn("[push] send failed", err);
        }
      }),
    );

    if (deadEndpoints.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
    }

    return { sent, cleaned: deadEndpoints.length };
  });