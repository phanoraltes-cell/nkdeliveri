import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { noIndexMeta } from "@/lib/seo";
import { TermsAcceptanceGate } from "@/components/terms-acceptance-gate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Applies to every nested dashboard route (head() merges down the whole
  // matched route chain) — account/dashboard pages are never meant to rank,
  // and robots.txt already blocks /dashboard from being crawled at all.
  head: () => noIndexMeta("Dashboard — NK Deliveri"),
  beforeLoad: async () => {
    // getSession() (not getUser()) deliberately — it reads the persisted
    // session from localStorage and lets the SDK's own autoRefreshToken
    // silently refresh an expiring/expired access token, with no network
    // round trip required to admit an already-valid session. getUser()
    // always calls Supabase's Auth API to re-verify the token; on this
    // route (evaluated on every navigation into any /dashboard/* page)
    // that made the whole dashboard's availability depend on that one
    // network call succeeding fast enough, every single time — a slow or
    // momentarily failed request bounced an already-logged-in user back to
    // /auth for no real reason (the actual authorization boundary is
    // Postgres RLS on every request, not this client-side guard — see
    // docs/MIGRATIONS.md and every RPC in supabase/migrations, which never
    // trust the client's role/session claims at face value). A genuinely
    // absent/expired/revoked session still correctly falls through to the
    // redirect below, since getSession() returns `session: null` in all of
    // those cases.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: "/auth" });
    const user = data.session.user;
    const [{ data: role, error: roleError }, { data: roleRows, error: rolesError }] =
      await Promise.all([
        supabase.rpc("get_primary_role", { _user_id: user.id }),
        // `user_roles` RLS already grants self-select (see
        // 20260702234435_...sql) — no RPC needed for "list my own roles".
        // Phase 7 of the admin evolution plan: the app is already
        // multi-role-capable at the DB layer (restaurant employee invites
        // create a second role on an existing account) but every guard
        // used to check only the single highest-priority role — allRoles
        // lets `requireRole` admit a user into *any* dashboard family they
        // actually hold, not just their top-priority one.
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
    // A failed role lookup previously fell back to "customer" silently —
    // a driver/admin/restaurant owner would get bounced to the wrong
    // dashboard with no indication why. Still fall back (better than a
    // hard lockout on a transient network blip) but make the failure
    // visible so it shows up in error tracking instead of vanishing.
    if (roleError) {
      console.error("[auth] get_primary_role_rpc failed", roleError, { userId: user.id });
    }
    if (rolesError) {
      console.error("[auth] user_roles fetch failed", rolesError, { userId: user.id });
    }
    const allRoles = (roleRows ?? []).map((r) => r.role as string);
    return {
      user,
      role: (role as string | null) ?? "customer",
      allRoles: allRoles.length > 0 ? allRoles : [(role as string | null) ?? "customer"],
    };
  },
  component: () => (
    <TermsAcceptanceGate>
      <Outlet />
    </TermsAcceptanceGate>
  ),
});
