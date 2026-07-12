import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardHeader } from "@/components/dashboard/navbar/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/sidebar/dashboard-sidebar";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { role, user } = Route.useRouteContext();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-cream">
      <DashboardHeader role={role} user={user} onSignOut={signOut} />
      <div className="flex">
        <DashboardSidebar role={role} onSignOut={signOut} />
        <main className="min-w-0 flex-1 px-5 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
