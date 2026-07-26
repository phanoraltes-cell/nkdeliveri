/**
 * Phase 7 of the admin evolution plan: which specific role a multi-role
 * user is acting as depends on *which dashboard family they're currently
 * viewing*, not just their single highest-priority role — a
 * restaurant_staff account that also holds `driver` should see driver nav
 * (not restaurant nav) while under /dashboard/driver. Falls back to
 * `primaryRole` outside any known family (e.g. bare /dashboard, still
 * mid-redirect).
 */
export function activeRoleForPath(
  pathname: string,
  allRoles: readonly string[],
  primaryRole: string,
): string {
  if (pathname.startsWith("/dashboard/admin")) {
    return allRoles.includes("super_admin") ? "super_admin" : "admin";
  }
  if (pathname.startsWith("/dashboard/restaurant")) {
    return allRoles.includes("restaurant_owner") ? "restaurant_owner" : "restaurant_staff";
  }
  if (pathname.startsWith("/dashboard/driver")) return "driver";
  if (pathname.startsWith("/dashboard/customer")) return "customer";
  return primaryRole;
}

export type DashboardFamily = { to: string; label: string };

const FAMILY_BY_ROLE: Record<string, DashboardFamily> = {
  customer: { to: "/dashboard/customer", label: "Kliyan" },
  restaurant_owner: { to: "/dashboard/restaurant", label: "Restoran" },
  restaurant_staff: { to: "/dashboard/restaurant", label: "Restoran" },
  driver: { to: "/dashboard/driver", label: "Livrè" },
  admin: { to: "/dashboard/admin", label: "Admin" },
  super_admin: { to: "/dashboard/admin", label: "Admin" },
};

/** Distinct dashboard families a user's role list gives them access to, deduped (owner+staff and admin+super_admin collapse to one entry each). */
export function dashboardFamilies(allRoles: readonly string[]): DashboardFamily[] {
  const seen = new Map<string, DashboardFamily>();
  for (const role of allRoles) {
    const family = FAMILY_BY_ROLE[role];
    if (family && !seen.has(family.to)) seen.set(family.to, family);
  }
  return [...seen.values()];
}
