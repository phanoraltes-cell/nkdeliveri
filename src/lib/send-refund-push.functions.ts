import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ refundId: z.string().uuid() });

/** Called right after review_refund_secure/complete_refund_secure succeeds — notifies the customer. */
export const sendRefundStatusPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit_secure", {
      _action: "send_refund_status_push",
      _max_hits: 30,
      _window_seconds: 600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) return { sent: 0, rateLimited: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: refund, error } = await supabaseAdmin
      .from("refunds")
      .select("id, status, customer_id, order_id, orders(order_number)")
      .eq("id", data.refundId)
      .single();
    if (error || !refund) throw new Error(error?.message || "Refund not found");

    const orderNumber = refund.orders?.order_number ?? "";
    let title = "";
    let body = "";
    if (refund.status === "approved") {
      title = "Ranbousman apwouve ✅";
      body = `Demann ranbousman ou pou kòmand ${orderNumber} apwouve. Lajan an ap trete.`;
    } else if (refund.status === "rejected") {
      title = "Ranbousman rejte";
      body = `Demann ranbousman ou pou kòmand ${orderNumber} rejte.`;
    } else if (refund.status === "completed") {
      title = "Lajan ranbouse 💸";
      body = `Ranbousman pou kòmand ${orderNumber} trete. Mèsi pou pasyans ou.`;
    } else {
      return { sent: 0, skipped: true };
    }

    const { pushToUsers } = await import("@/lib/push-dispatch.server");
    return pushToUsers([refund.customer_id], {
      title,
      body,
      url: `/orders/${refund.order_id}`,
      tag: `refund-${refund.id}`,
      data: { orderId: refund.order_id, refundId: refund.id },
    });
  });
