import { createFileRoute, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "@/components/dashboard/navbar/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/sidebar/dashboard-sidebar";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { activeRoleForPath } from "@/lib/dashboard-family";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { role, allRoles, user } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Which family's nav/header to show: derived from the URL, not just the
  // single highest-priority role, so a multi-role user sees the correct
  // nav after switching dashboards (Phase 7 of the admin evolution plan).
  const activeRole = activeRoleForPath(pathname, allRoles, role);
  // Only staff need this — it drives which nav links an operational role
  // (cook/prep/cashier) sees. Owners/admins/drivers/customers skip the query.
  const { data: myRestaurant } = useMyRestaurant(
    activeRole === "restaurant_staff" ? user?.id : undefined,
  );
  const employeeRole = myRestaurant?.employeeRole;

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-cream">
      <DashboardHeader
        role={activeRole}
        allRoles={allRoles}
        user={user}
        employeeRole={employeeRole}
        onSignOut={signOut}
      />
      <div className="flex">
        <DashboardSidebar role={activeRole} employeeRole={employeeRole} onSignOut={signOut} />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
