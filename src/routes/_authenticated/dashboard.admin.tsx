import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is required:
// dashboard.admin.users.tsx, .payments.tsx, etc. are children of this route
// by TanStack Router's flat file convention, and without an Outlet here they
// had nowhere to render — clicking their tiles updated the URL but left the
// admin dashboard's own content on screen.
export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: () => <Outlet />,
});
