import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";

// Pure layout: dashboard.restaurant.menu.tsx, .orders.tsx, .profile.tsx, etc.
// are all registered as children of this route by TanStack Router's flat
// file convention (shared "dashboard.restaurant" prefix). Without this
// Outlet, navigating to any of them left the URL updated but rendered
// nothing new — the parent's own component (formerly the tile grid, now
// moved to dashboard.restaurant.index.tsx) had no slot to show the matched
// child in. The role check lives here so it guards the whole subtree once,
// instead of only the pages that happened to repeat it themselves.
//
// This is the WIDER of the two guards used across the restaurant family —
// it admits restaurant_staff. Five children (employees/payouts/profile/
// promotions/revenue) intentionally apply a NARROWER guard of their own
// that excludes restaurant_staff (owner-only financial/management pages) —
// those are not redundant with this one, do not remove them.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant")({
  beforeLoad: ({ context }) => {
    requireRole(context.role, ["restaurant_owner", "restaurant_staff", "admin", "super_admin"]);
  },
  component: () => <Outlet />,
});
