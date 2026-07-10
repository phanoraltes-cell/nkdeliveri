import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is required:
// dashboard.driver.available.tsx, .history.tsx, etc. are children of this
// route by TanStack Router's flat file convention, and without an Outlet
// here they had nowhere to render.
export const Route = createFileRoute("/_authenticated/dashboard/driver")({
  component: () => <Outlet />,
});
