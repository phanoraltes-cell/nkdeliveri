import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pure layout — see dashboard.restaurant.tsx for why this Outlet is
// required: dashboard.customer.index.tsx (moved here from this file, which
// used to be the customer dashboard itself) and dashboard.customer.chat.tsx
// are children of this route by TanStack Router's flat file convention.
//
// Still intentionally no role guard here (see the moved index route's own
// comment) — any authenticated role may view the customer dashboard family.
export const Route = createFileRoute("/_authenticated/dashboard/customer")({
  component: () => <Outlet />,
});
