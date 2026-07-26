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
    const [{ data: role, error: roleError }, { data: roleRows, error: rolesError }] =
      await Promise.all([
        supabase.rpc("get_primary_role", { _user_id: data.user.id }),
        // `user_roles` RLS already grants self-select (see
        // 20260702234435_...sql) — no RPC needed for "list my own roles".
        // Phase 7 of the admin evolution plan: the app is already
        // multi-role-capable at the DB layer (restaurant employee invites
        // create a second role on an existing account) but every guard
        // used to check only the single highest-priority role — allRoles
        // lets `requireRole` admit a user into *any* dashboard family they
        // actually hold, not just their top-priority one.
        supabase.from("user_roles").select("role").eq("user_id", data.user.id),
      ]);
    // A failed role lookup previously fell back to "customer" silently —
    // a driver/admin/restaurant owner would get bounced to the wrong
    // dashboard with no indication why. Still fall back (better than a
    // hard lockout on a transient network blip) but make the failure
    // visible so it shows up in error tracking instead of vanishing.
    if (roleError) {
      console.error("[auth] get_primary_role_rpc failed", roleError, { userId: data.user.id });
    }
    if (rolesError) {
      console.error("[auth] user_roles fetch failed", rolesError, { userId: data.user.id });
    }
    const allRoles = (roleRows ?? []).map((r) => r.role as string);
    return {
      user: data.user,
      role: (role as string | null) ?? "customer",
      allRoles: allRoles.length > 0 ? allRoles : [(role as string | null) ?? "customer"],
    };
  },
  component: () => <Outlet />,
});
