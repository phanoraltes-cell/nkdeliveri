import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    const map: Record<string, string> = {
      customer: "/dashboard/customer",
      restaurant_owner: "/dashboard/restaurant",
      restaurant_staff: "/dashboard/restaurant",
      driver: "/dashboard/driver",
      admin: "/dashboard/admin",
      super_admin: "/dashboard/admin",
    };
    throw redirect({ to: map[role] ?? "/dashboard/customer" });
  },
});