import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";

const InputSchema = z.object({ paymentId: z.string().uuid() });

/**
 * Post-incident audit remediation, Correction 5
 * (docs/archive/payments/PAYMENT_POST_INCIDENT_AUDIT.md "Bug confirmé n°5" /
 * docs/archive/payments/PAYMENT_POST_INCIDENT_REMEDIATION_REPORT.md). Closes the gap
 * documented in [[project_notification_push_convention]]: every
 * `private.notify_secure` call needs a matching `send-*-push.functions.ts`
 * sibling, and `create_collect_payment_secure`'s own
 * `collect_payment_admin_error` notification (fired for every admin/
 * super_admin whenever an automatic Payment Global attempt fails) never
 * had one — admins only ever learned about a failed attempt from the
 * in-app bell (`notifications` table), never a real push.
 *
 * Called right after `initiateCollectPayment` returns `{ outcome: "failed"
 * }` — mirrors every other `send-*-push.functions.ts` file's "client-side
 * best-effort follow-up right after the mutating RPC succeeds" shape
 * ([[project_notification_push_convention]]), even though here the RPC's
 * own *notification* is what "succeeded", not the payment itself. Reuses
 * `pushToUsers` (the one push engine every other file in this directory
 * already shares) — no second notification system introduced.
 *
 * Does NOT re-implement `create_collect_payment_secure`'s own
 * admin/super_admin role lookup logic differently — same
 * `user_roles.role IN ('admin', 'super_admin')` query, so the audience is
 * always identical to who already got the in-app notification.
 */
export const sendCollectPaymentAdminErrorPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ownership check mirrors send-order-push.functions.ts's own pattern —
    // defense in depth even though create_collect_payment_secure (already
    // called before this) enforces the same `o.customer_id = auth.uid()`
    // constraint on this exact payment.
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .select("amount, order_id, orders(order_number, customer_id)")
      .eq("id", data.paymentId)
      .single();
    if (paymentError || !payment) throw new Error(paymentError?.message || "Payment not found");
    if (payment.orders?.customer_id !== context.userId) throw new Error("Forbidden");

    if (
      !(await enforceRateLimit(context.supabase, "send_collect_payment_admin_error_push", 20, 600))
    ) {
      return { sent: 0, rateLimited: true };
    }

    const { data: admins, error: adminsError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    if (adminsError) throw new Error(adminsError.message);

    const adminIds = (admins ?? []).map((r) => r.user_id);
    if (adminIds.length === 0) return { sent: 0 };

    const orderNumber = payment.orders?.order_number ?? "";
    return pushToUsers(adminIds, {
      title: "Tantativ peman kliyan echwe",
      body: `Yon peman Payment Global ${payment.amount} HTG pou kòmand ${orderNumber} echwe.`,
      url: `/dashboard/admin`,
      tag: `collect-payment-error-${data.paymentId}`,
      data: { paymentId: data.paymentId, orderId: payment.order_id },
    });
  });
