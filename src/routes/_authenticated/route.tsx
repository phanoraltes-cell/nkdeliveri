import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Applies to every nested dashboard route (head() merges down the whole
  // matched route chain) — account/dashboard pages are never meant to rank,
  // and robots.txt already blocks /dashboard from being crawled at all.
  head: () => noIndexMeta("Dashboard — NK Deliveri"),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: role, error: roleError } = await supabase.rpc("get_primary_role", {
      _user_id: data.user.id,
    });
    // A failed role lookup previously fell back to "customer" silently —
    // a driver/admin/restaurant owner would get bounced to the wrong
    // dashboard with no indication why. Still fall back (better than a
    // hard lockout on a transient network blip) but make the failure
    // visible so it shows up in error tracking instead of vanishing.
    if (roleError) {
      console.error("[auth] get_primary_role_rpc failed", roleError, { userId: data.user.id });
    }
    return { user: data.user, role: (role as string | null) ?? "customer" };
  },
  component: () => <Outlet />,
});
