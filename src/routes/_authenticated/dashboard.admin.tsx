import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is required:
// dashboard.admin.users.tsx, .payments.tsx, etc. are children of this route
// by TanStack Router's flat file convention, and without an Outlet here they
// had nowhere to render — clicking their tiles updated the URL but left the
// admin dashboard's own content on screen.
export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  beforeLoad: ({ context }) => {
    requireRole(context.allRoles, ["admin", "super_admin"]);
  },
  component: () => <Outlet />,
});
