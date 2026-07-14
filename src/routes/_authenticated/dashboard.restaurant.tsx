import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// Pure layout: dashboard.restaurant.menu.tsx, .orders.tsx, .profile.tsx, etc.
// are all registered as children of this route by TanStack Router's flat
// file convention (shared "dashboard.restaurant" prefix). Without this
// Outlet, navigating to any of them left the URL updated but rendered
// nothing new — the parent's own component (formerly the tile grid, now
// moved to dashboard.restaurant.index.tsx) had no slot to show the matched
// child in. The role check lives here so it guards the whole subtree once,
// instead of only the pages that happened to repeat it themselves.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (
      role !== "restaurant_owner" &&
      role !== "restaurant_staff" &&
      role !== "admin" &&
      role !== "super_admin"
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: () => <Outlet />,
});
