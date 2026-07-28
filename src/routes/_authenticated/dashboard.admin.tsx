import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { AdminIdleLock } from "@/components/dashboard/admin/admin-idle-lock";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is required:
// dashboard.admin.users.tsx, .payments.tsx, etc. are children of this route
// by TanStack Router's flat file convention, and without an Outlet here they
// had nowhere to render — clicking their tiles updated the URL but left the
// admin dashboard's own content on screen.
//
// AdminIdleLock wraps every admin page from this single spot (session-
// hardening request, Phase 3) — mounting it here instead of in each
// dashboard.admin.*.tsx file is what makes the idle lock apply uniformly
// to the whole admin family with zero changes to any of those files.
export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  beforeLoad: ({ context }) => {
    requireRole(context.allRoles, ["admin", "super_admin"]);
  },
  component: () => (
    <AdminIdleLock>
      <Outlet />
    </AdminIdleLock>
  ),
});
