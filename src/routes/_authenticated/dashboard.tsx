import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "@/components/dashboard/navbar/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/sidebar/dashboard-sidebar";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { role, user } = Route.useRouteContext();
  const router = useRouter();
  // Only staff need this — it drives which nav links an operational role
  // (cook/prep/cashier) sees. Owners/admins/drivers/customers skip the query.
  const { data: myRestaurant } = useMyRestaurant(
    role === "restaurant_staff" ? user?.id : undefined,
  );
  const employeeRole = myRestaurant?.employeeRole;

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-cream">
      <DashboardHeader role={role} user={user} employeeRole={employeeRole} onSignOut={signOut} />
      <div className="flex">
        <DashboardSidebar role={role} employeeRole={employeeRole} onSignOut={signOut} />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
