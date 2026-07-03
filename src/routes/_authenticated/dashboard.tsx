import { createFileRoute, Outlet, Link, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, LayoutDashboard, User, Store, Bike, ShieldCheck } from "lucide-react";
import nkLogo from "@/assets/nk-logo.png.asset.json";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const NAV_BY_ROLE: Record<string, { to: string; label: string; icon: any }[]> = {
  customer: [{ to: "/dashboard/customer", label: "Dashboard Kliyan", icon: User }],
  restaurant_owner: [{ to: "/dashboard/restaurant", label: "Dashboard Restoran", icon: Store }],
  restaurant_staff: [{ to: "/dashboard/restaurant", label: "Dashboard Restoran", icon: Store }],
  driver: [{ to: "/dashboard/driver", label: "Dashboard Livrè", icon: Bike }],
  admin: [{ to: "/dashboard/admin", label: "Dashboard Admin", icon: ShieldCheck }],
  super_admin: [{ to: "/dashboard/admin", label: "Dashboard Admin", icon: ShieldCheck }],
};

function DashboardLayout() {
  const { role, user } = Route.useRouteContext();
  const router = useRouter();
  const items = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.customer;

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-brand-soft/50 bg-white px-5 shadow-sm">
        <Link to="/" className="flex items-center gap-2">
          <img src={nkLogo.url} alt="NK" className="h-9 w-9 rounded-full" />
          <span className="font-display text-lg font-extrabold text-ink">
            NK <span className="text-brand">Delivery</span>
          </span>
        </Link>
        <span className="ml-2 rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-deep">
          {role.replace("_", " ")}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-ink-soft sm:inline">{user?.email}</span>
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-soft bg-white px-3 py-1.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft/40"
          >
            <LogOut className="h-4 w-4" /> Dekonekte
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-5 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-24 flex flex-col gap-1 rounded-2xl border border-brand-soft/60 bg-white p-2 shadow-sm">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  activeProps={{ className: "!bg-brand !text-white" }}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-brand-soft/40"
                >
                  <Icon className="h-4 w-4" />
                  {it.label}
                </Link>
              );
            })}
            <Link
              to="/"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-soft hover:bg-brand-soft/30"
            >
              <LayoutDashboard className="h-4 w-4" /> Retounen sou sit la
            </Link>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}