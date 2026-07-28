import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";

const InputSchema = z.object({
  payoutId: z.string().uuid(),
  event: z.enum(["paid", "confirmed", "disputed", "reversed"]),
});

/**
 * Called right after initiate_payout_secure / confirm_payout_secure /
 * dispute_payout_secure / resolve_payout_dispute_secure succeeds — the DB
 * write and the notification row are already done inline in the RPC; this
 * is only the best-effort push, fire-and-forget from the client's
 * onSuccess, same posture as sendDisputeUpdatePush/sendRefundStatusPush.
 */
export const sendPayoutUpdatePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (!(await enforceRateLimit(supabase, "send_payout_push", 40, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const { data: payout, error } = await supabase
      .from("payouts")
      .select("id, amount, paid_by, restaurants(owner_id), drivers(user_id)")
      .eq("id", data.payoutId)
      .single();
    if (error || !payout) throw new Error(error?.message || "Payout not found");

    const beneficiaryId = payout.restaurants?.owner_id ?? payout.drivers?.user_id ?? null;

    if (data.event === "paid" || data.event === "reversed") {
      if (!beneficiaryId) return { sent: 0 };
      const title = data.event === "paid" ? "Ou resevwa yon peman" : "Peman ranvèse";
      const body =
        data.event === "paid"
          ? `Ou resevwa yon peman ${payout.amount} HTG. Tanpri konfime resepsyon an.`
          : `Yon peman ${payout.amount} HTG ranvèse. Li retounen nan balans disponib ou.`;
      return pushToUsers([beneficiaryId], {
        title,
        body,
        url: "/dashboard",
        tag: `payout-${payout.id}`,
        data: { payoutId: payout.id },
      });
    }

    if (data.event === "confirmed") {
      return pushToUsers([payout.paid_by], {
        title: "Peman konfime",
        body: `Benefisyè a konfime li resevwa peman ${payout.amount} HTG.`,
        url: "/dashboard/admin/payouts",
        tag: `payout-${payout.id}`,
        data: { payoutId: payout.id },
      });
    }

    // disputed: every admin/super_admin, mirroring dispute_payout_secure's own DB-side fan-out.
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    const adminIds = Array.from(new Set((admins ?? []).map((a) => a.user_id)));
    if (adminIds.length === 0) return { sent: 0 };
    return pushToUsers(adminIds, {
      title: "Yon peman kontete",
      body: `Yon benefisyè rapòte yon pwoblèm sou yon peman ${payout.amount} HTG.`,
      url: "/dashboard/admin/payouts",
      tag: `payout-${payout.id}`,
      data: { payoutId: payout.id },
    });
  });
