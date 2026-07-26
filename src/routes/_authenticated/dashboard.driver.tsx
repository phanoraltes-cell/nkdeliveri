import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is required:
// dashboard.driver.available.tsx, .history.tsx, etc. are children of this
// route by TanStack Router's flat file convention, and without an Outlet
// here they had nowhere to render.
//
// This layout previously had NO role guard at all, unlike its admin/
// restaurant siblings — dashboard.driver.index.tsx and .profile.tsx (which
// had no guard of their own either) were reachable by direct URL for any
// authenticated role. The role check lives here so it guards the whole
// subtree once, matching the other families.
export const Route = createFileRoute("/_authenticated/dashboard/driver")({
  beforeLoad: ({ context }) => {
    requireRole(context.allRoles, ["driver", "admin", "super_admin"]);
  },
  component: () => <Outlet />,
});
