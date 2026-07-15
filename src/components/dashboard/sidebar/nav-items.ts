import {
  LayoutDashboard,
  ShoppingBag,
  Store,
  Users,
  CreditCard,
  Wallet,
  UtensilsCrossed,
  Megaphone,
  UserCog,
  History,
  Gauge,
  MapPin,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

export type DashboardRole =
  "customer" | "restaurant_owner" | "restaurant_staff" | "driver" | "admin" | "super_admin";

/**
 * Single source of truth for dashboard navigation, consumed by both
 * DashboardSidebar (desktop) and MobileDrawer (mobile) so the two never
 * drift out of sync the way the old inline nav in dashboard.tsx did.
 * Only routes that actually exist in src/routes are referenced here.
 */
const NAV_BY_ROLE: Record<DashboardRole, NavItem[]> = {
  customer: [
    { to: "/dashboard/customer", label: "Akèy", icon: LayoutDashboard },
    { to: "/restaurants", label: "Restoran", icon: Store },
    { to: "/orders", label: "Kòmand mwen", icon: ShoppingBag },
    { to: "/profile", label: "Adrès ak peman", icon: MapPin },
  ],
  restaurant_owner: [
    { to: "/dashboard/restaurant", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/restaurant/orders", label: "Kòmand", icon: ShoppingBag },
    { to: "/dashboard/restaurant/menu", label: "Meni", icon: UtensilsCrossed },
    { to: "/dashboard/restaurant/promotions", label: "Pwomosyon", icon: Megaphone },
    { to: "/dashboard/restaurant/employees", label: "Anplwaye", icon: UserCog },
    { to: "/dashboard/restaurant/revenue", label: "Revni", icon: Gauge },
    { to: "/dashboard/restaurant/payouts", label: "Peman", icon: Wallet },
  ],
  restaurant_staff: [
    { to: "/dashboard/restaurant", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/restaurant/orders", label: "Kòmand", icon: ShoppingBag },
    { to: "/dashboard/restaurant/menu", label: "Meni", icon: UtensilsCrossed },
    { to: "/dashboard/restaurant/promotions", label: "Pwomosyon", icon: Megaphone },
  ],
  driver: [
    { to: "/dashboard/driver", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/driver/available", label: "Disponiblite", icon: Gauge },
    { to: "/dashboard/driver/history", label: "Istwa livrezon", icon: History },
    { to: "/dashboard/driver/earnings", label: "Revni", icon: Wallet },
    { to: "/dashboard/driver/payouts", label: "Peman", icon: CreditCard },
  ],
  admin: [
    { to: "/dashboard/admin", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/admin/users", label: "Itilizatè", icon: Users },
    { to: "/dashboard/admin/customers", label: "Kliyan", icon: UserCog },
    { to: "/dashboard/admin/restaurants", label: "Restoran", icon: Store },
    { to: "/dashboard/admin/payments", label: "Peman", icon: CreditCard },
    { to: "/dashboard/admin/refunds", label: "Ranbousman", icon: RotateCcw },
    { to: "/dashboard/admin/payout-settings", label: "Paramèt peman", icon: Wallet },
  ],
  super_admin: [
    { to: "/dashboard/admin", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/admin/users", label: "Itilizatè", icon: Users },
    { to: "/dashboard/admin/customers", label: "Kliyan", icon: UserCog },
    { to: "/dashboard/admin/restaurants", label: "Restoran", icon: Store },
    { to: "/dashboard/admin/payments", label: "Peman", icon: CreditCard },
    { to: "/dashboard/admin/refunds", label: "Ranbousman", icon: RotateCcw },
    { to: "/dashboard/admin/payout-settings", label: "Paramèt peman", icon: Wallet },
  ],
};

export function getNavItems(role: string): NavItem[] {
  return NAV_BY_ROLE[role as DashboardRole] ?? NAV_BY_ROLE.customer;
}

// Roles with an actual profile-editing page get a Pwofil link in the sidebar/drawer footer.
export const PROFILE_LINK_BY_ROLE: Record<string, string | undefined> = {
  customer: "/profile",
  driver: "/dashboard/driver/profile",
  restaurant_owner: "/dashboard/restaurant/profile",
  restaurant_staff: "/dashboard/restaurant/profile",
};
