import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Role-agnostic deep link — sendOrderChatPush and the in-app notification
// list both point here instead of guessing a role-specific URL, since a
// single chat-message notification fans out to customer + driver + every
// admin at once and there's no per-recipient URL in pushToUsers' payload.
//
// Multi-role hardening (NK Deliveri remediation 06): the destination must
// be the family this user is a *participant in for this specific order*,
// not just any family whose role they happen to hold anywhere in the app.
// A customer who also holds the `driver` role (works both sides) would
// previously always be routed to /dashboard/driver/chat on any chat link —
// including for an order where *they themselves ordered as a customer* —
// because the old check only asked "does this account hold the driver role
// at all", never "are they the driver *of this order*". They'd land on a
// dashboard whose chat list has no reason to contain that conversation.
// Fixed by checking the order's actual customer_id first — RLS (`orders
// read`) already scopes this same query correctly for a driver too (only
// visible if they're the assigned driver), so a non-null, non-owned result
// reaching the driver branch below is only ever reachable by someone who
// really is that order's driver.
export const Route = createFileRoute("/_authenticated/chat/$orderId")({
  beforeLoad: async ({ context, params }) => {
    const { allRoles, user } = context;
    const { data: order } = await supabase
      .from("orders")
      .select("customer_id")
      .eq("id", params.orderId)
      .maybeSingle();

    let to: string;
    if (order?.customer_id === user.id) {
      to = "/dashboard/customer/chat";
    } else if (allRoles.includes("admin") || allRoles.includes("super_admin")) {
      to = "/dashboard/admin/chat";
    } else if (order && allRoles.includes("driver")) {
      to = "/dashboard/driver/chat";
    } else {
      // Order not visible to this account at all (bystander, stale link) or
      // no role-specific match — same fallback as before the fix.
      to = "/dashboard/customer/chat";
    }
    throw redirect({ to, search: { order: params.orderId } });
  },
});
