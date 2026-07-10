import { createFileRoute, Outlet, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, LayoutDashboard, User, Store, Bike, ShieldCheck, Bell, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const NAV_BY_ROLE: Record<string, { to: string; label: string; icon: LucideIcon }[]> = {
  customer: [{ to: "/dashboard/customer", label: "Dashboard Kliyan", icon: User }],
  restaurant_owner: [{ to: "/dashboard/restaurant", label: "Dashboard Restoran", icon: Store }],
  restaurant_staff: [{ to: "/dashboard/restaurant", label: "Dashboard Restoran", icon: Store }],
  driver: [{ to: "/dashboard/driver", label: "Dashboard Livrè", icon: Bike }],
  admin: [{ to: "/dashboard/admin", label: "Dashboard Admin", icon: ShieldCheck }],
  super_admin: [{ to: "/dashboard/admin", label: "Dashboard Admin", icon: ShieldCheck }],
};

// Only roles with an actual profile-editing page get a clickable icon.
const PROFILE_LINK_BY_ROLE: Record<string, string | undefined> = {
  customer: "/profile",
  driver: "/dashboard/driver/profile",
  restaurant_owner: "/dashboard/restaurant/profile",
};

function DashboardLayout() {
  const { role, user } = Route.useRouteContext();
  const router = useRouter();
  const items = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.customer;

  const { data: unread = 0 } = useQuery({
    queryKey: ["notif-unread", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      return count ?? 0;
    },
  });

  const { data: avatarUrl } = useQuery({
    queryKey: ["header-avatar", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("avatar_url").eq("id", user!.id).maybeSingle();
      return data?.avatar_url ?? null;
    },
  });
  const profileLink = PROFILE_LINK_BY_ROLE[role];
  const avatarNode = avatarUrl ? (
    <img src={avatarUrl} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full border border-brand-soft object-cover" />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
      <User className="h-4 w-4" />
    </div>
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-40 flex min-h-16 items-center gap-1.5 border-b border-brand-soft/50 bg-white pt-[var(--sat)] pb-2 pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] shadow-sm sm:gap-3 sm:pl-[max(1.25rem,var(--sal))] sm:pr-[max(1.25rem,var(--sar))]">
        <Link to="/" className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
          <img src="/nk-logo.png" alt="NK" width={36} height={36} className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9" />
          <span className="truncate font-display text-base font-extrabold text-ink sm:text-lg">
            NK <span className="text-brand">Deliveri</span>
          </span>
        </Link>
        <span className="hidden shrink-0 truncate rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-deep sm:ml-2 sm:inline-block">
          {role.replace("_", " ")}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
          <Link
            to="/notifications"
            className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-soft bg-white text-brand-deep hover:bg-brand-soft/40"
            aria-label="Notifikasyon"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
          {profileLink ? (
            <Link to={profileLink} aria-label="Pwofil mwen" className="shrink-0">
              {avatarNode}
            </Link>
          ) : (
            avatarNode
          )}
          <span className="hidden text-sm text-ink-soft md:inline">{user?.email}</span>
          <button
            onClick={signOut}
            aria-label="Dekonekte"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-brand-soft bg-white px-2.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft/40 sm:px-3"
          >
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Dekonekte</span>
          </button>
        </div>
      </header>
      <nav className="flex gap-2 overflow-x-auto border-b border-brand-soft/50 bg-white py-2.5 pl-[max(1.25rem,var(--sal))] pr-[max(1.25rem,var(--sar))] md:hidden">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              activeProps={{ className: "!bg-brand !text-white" }}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand-soft/40 px-3.5 text-xs font-bold text-brand-deep"
            >
              <Icon className="h-3.5 w-3.5" /> {it.label}
            </Link>
          );
        })}
        <Link
          to="/"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand-soft/20 px-3.5 text-xs font-semibold text-ink-soft"
        >
          <LayoutDashboard className="h-3.5 w-3.5" /> Sit la
        </Link>
      </nav>
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