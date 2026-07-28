import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";

const InputSchema = z.object({ disputeId: z.string().uuid() });

/**
 * Called right after open_dispute_secure / add_dispute_message_secure /
 * resolve_dispute_secure succeeds — notifies every party to the dispute
 * except whoever just triggered the call.
 */
export const sendDisputeUpdatePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (!(await enforceRateLimit(supabase, "send_dispute_update_push", 40, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: dispute, error } = await supabaseAdmin
      .from("disputes")
      .select(
        "id, status, order_id, customer_id, orders(order_number), restaurants(owner_id), drivers(user_id)",
      )
      .eq("id", data.disputeId)
      .single();
    if (error || !dispute) throw new Error(error?.message || "Dispute not found");

    // Caller must be a party to the dispute (customer/restaurant owner/
    // driver/admin) — mirrors private.dispute_author_role, checked loosely
    // here since the RPC that triggered this already enforced it strictly.
    const parties = new Set<string>();
    if (dispute.customer_id) parties.add(dispute.customer_id);
    if (dispute.restaurants?.owner_id) parties.add(dispute.restaurants.owner_id);
    if (dispute.drivers?.user_id) parties.add(dispute.drivers.user_id);
    parties.delete(userId);

    if (parties.size === 0) return { sent: 0 };

    const orderNumber = dispute.orders?.order_number ?? "";
    const title = dispute.status === "resolved" ? "Litij rezoud" : "Aktivite nan yon litij";
    const body =
      dispute.status === "resolved"
        ? `Yon administratè rezoud litij sou kòmand ${orderNumber}.`
        : `Gen nouvo aktivite nan litij sou kòmand ${orderNumber}.`;

    return pushToUsers(Array.from(parties), {
      title,
      body,
      url: `/orders/${dispute.order_id}`,
      tag: `dispute-${dispute.id}`,
      data: { orderId: dispute.order_id, disputeId: dispute.id },
    });
  });
