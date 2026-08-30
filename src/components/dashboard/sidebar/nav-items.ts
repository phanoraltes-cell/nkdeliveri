import {
  LayoutDashboard,
  ShoppingBag,
  Store,
  Bike,
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
  AlertTriangle,
  Flag,
  Banknote,
  Percent,
  MessageCircle,
  BarChart3,
  Zap,
  ShieldCheck,
  Radar,
  FileSignature,
  Handshake,
  type LucideIcon,
} from "lucide-react";
import { isOperationalRole } from "@/lib/employee-roles";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Adjacent items sharing the same section render one small group heading above the first of them — see DashboardSidebar/MobileDrawer. */
  section?: string;
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
    { to: "/dashboard/customer/chat", label: "Chat", icon: MessageCircle },
    { to: "/profile", label: "Adrès ak peman", icon: MapPin },
  ],
  restaurant_owner: [
    { to: "/dashboard/restaurant", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/restaurant/orders", label: "Kòmand", icon: ShoppingBag },
    { to: "/dashboard/restaurant/menu", label: "Meni", icon: UtensilsCrossed },
    { to: "/dashboard/restaurant/promotions", label: "Pwomosyon", icon: Megaphone },
    { to: "/dashboard/restaurant/employees", label: "Anplwaye", icon: UserCog },
    { to: "/dashboard/restaurant/disputes", label: "Litij", icon: AlertTriangle },
    { to: "/dashboard/restaurant/reports", label: "Siyalman", icon: Flag },
    { to: "/dashboard/restaurant/revenue", label: "Revni", icon: Gauge },
    { to: "/dashboard/restaurant/commissions", label: "Komisyon", icon: Percent },
    { to: "/dashboard/restaurant/payouts", label: "Peman", icon: Wallet },
  ],
  restaurant_staff: [
    { to: "/dashboard/restaurant", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/restaurant/orders", label: "Kòmand", icon: ShoppingBag },
    { to: "/dashboard/restaurant/menu", label: "Meni", icon: UtensilsCrossed },
    { to: "/dashboard/restaurant/promotions", label: "Pwomosyon", icon: Megaphone },
    { to: "/dashboard/restaurant/disputes", label: "Litij", icon: AlertTriangle },
    { to: "/dashboard/restaurant/reports", label: "Siyalman", icon: Flag },
  ],
  driver: [
    { to: "/dashboard/driver", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/driver/available", label: "Disponiblite", icon: Gauge },
    { to: "/dashboard/driver/history", label: "Istwa livrezon", icon: History },
    { to: "/dashboard/driver/chat", label: "Chat", icon: MessageCircle },
    { to: "/dashboard/driver/disputes", label: "Litij", icon: AlertTriangle },
    { to: "/dashboard/driver/reports", label: "Siyalman", icon: Flag },
    { to: "/dashboard/driver/earnings", label: "Revni", icon: Wallet },
    { to: "/dashboard/driver/commissions", label: "Komisyon", icon: Percent },
    { to: "/dashboard/driver/payouts", label: "Peman", icon: CreditCard },
  ],
  admin: [
    { to: "/dashboard/admin", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/admin/users", label: "Itilizatè", icon: Users },
    { to: "/dashboard/admin/customers", label: "Kliyan", icon: UserCog },
    { to: "/dashboard/admin/restaurants", label: "Restoran", icon: Store },
    { to: "/dashboard/admin/drivers", label: "Livrè", icon: Bike },
    { to: "/dashboard/admin/chat", label: "Chat", icon: MessageCircle },
    { to: "/dashboard/admin/disputes", label: "Litij", icon: AlertTriangle },
    { to: "/dashboard/admin/reports", label: "Siyalman", icon: Flag },
    { to: "/dashboard/admin/komand", label: "Komand", icon: Radar },
    { to: "/dashboard/admin/finance", label: "Tablo Finansye", icon: BarChart3, section: "Finans" },
    { to: "/dashboard/admin/payments", label: "Peman Kliyan", icon: CreditCard, section: "Finans" },
    { to: "/dashboard/admin/commissions", label: "Komisyon", icon: Percent, section: "Finans" },
    { to: "/dashboard/admin/payouts", label: "Dekesman", icon: Banknote, section: "Finans" },
    { to: "/dashboard/admin/collect", label: "Peman Otomatik", icon: Zap, section: "Finans" },
    { to: "/dashboard/admin/refunds", label: "Ranbousman", icon: RotateCcw, section: "Finans" },
    {
      to: "/dashboard/admin/payout-settings",
      label: "Paramèt peman",
      icon: Wallet,
      section: "Finans",
    },
    {
      to: "/dashboard/admin/payment-providers",
      label: "Fournisseurs",
      icon: CreditCard,
      section: "Finans",
    },
    {
      to: "/dashboard/admin/promo-codes",
      label: "Kòd Pwomo",
      icon: Percent,
      section: "Finans",
    },
    { to: "/dashboard/admin/ads", label: "Piblisite", icon: Megaphone },
    { to: "/dashboard/admin/contracts", label: "Kontra Restoran", icon: FileSignature },
    { to: "/dashboard/admin/partners", label: "Patnè Ofisyèl", icon: Handshake },
    { to: "/dashboard/admin/security", label: "Sekirite kont", icon: ShieldCheck },
  ],
  super_admin: [
    { to: "/dashboard/admin", label: "Akèy", icon: LayoutDashboard },
    { to: "/dashboard/admin/users", label: "Itilizatè", icon: Users },
    { to: "/dashboard/admin/customers", label: "Kliyan", icon: UserCog },
    { to: "/dashboard/admin/restaurants", label: "Restoran", icon: Store },
    { to: "/dashboard/admin/drivers", label: "Livrè", icon: Bike },
    { to: "/dashboard/admin/chat", label: "Chat", icon: MessageCircle },
    { to: "/dashboard/admin/disputes", label: "Litij", icon: AlertTriangle },
    { to: "/dashboard/admin/reports", label: "Siyalman", icon: Flag },
    { to: "/dashboard/admin/komand", label: "Komand", icon: Radar },
    { to: "/dashboard/admin/finance", label: "Tablo Finansye", icon: BarChart3, section: "Finans" },
    { to: "/dashboard/admin/payments", label: "Peman Kliyan", icon: CreditCard, section: "Finans" },
    { to: "/dashboard/admin/commissions", label: "Komisyon", icon: Percent, section: "Finans" },
    { to: "/dashboard/admin/payouts", label: "Dekesman", icon: Banknote, section: "Finans" },
    { to: "/dashboard/admin/collect", label: "Peman Otomatik", icon: Zap, section: "Finans" },
    { to: "/dashboard/admin/refunds", label: "Ranbousman", icon: RotateCcw, section: "Finans" },
    {
      to: "/dashboard/admin/payout-settings",
      label: "Paramèt peman",
      icon: Wallet,
      section: "Finans",
    },
    {
      to: "/dashboard/admin/payment-providers",
      label: "Fournisseurs",
      icon: CreditCard,
      section: "Finans",
    },
    {
      to: "/dashboard/admin/promo-codes",
      label: "Kòd Pwomo",
      icon: Percent,
      section: "Finans",
    },
    { to: "/dashboard/admin/ads", label: "Piblisite", icon: Megaphone },
    { to: "/dashboard/admin/contracts", label: "Kontra Restoran", icon: FileSignature },
    { to: "/dashboard/admin/partners", label: "Patnè Ofisyèl", icon: Handshake },
    { to: "/dashboard/admin/security", label: "Sekirite kont", icon: ShieldCheck },
  ],
};

// Cook/prep/cashier are "operational" roles: order handling only, no menu
// or promotion editing — matches private.is_restaurant_staff_or_manager
// server-side, so this nav never links to a page whose mutations would
// just come back Forbidden.
const RESTAURANT_STAFF_OPERATIONAL_NAV: NavItem[] = [
  { to: "/dashboard/restaurant", label: "Akèy", icon: LayoutDashboard },
  { to: "/dashboard/restaurant/orders", label: "Kòmand", icon: ShoppingBag },
  { to: "/dashboard/restaurant/disputes", label: "Litij", icon: AlertTriangle },
  { to: "/dashboard/restaurant/reports", label: "Siyalman", icon: Flag },
];

export function getNavItems(role: string, employeeRole?: string | null): NavItem[] {
  if (role === "restaurant_staff" && isOperationalRole(employeeRole)) {
    return RESTAURANT_STAFF_OPERATIONAL_NAV;
  }
  return NAV_BY_ROLE[role as DashboardRole] ?? NAV_BY_ROLE.customer;
}

// Roles with an actual profile-editing page get a Pwofil link in the sidebar/drawer footer.
// admin/super_admin never had one — they share the customer page since it's
// already open to any authenticated user regardless of role and is where
// "Sesyon aktif" (Active Sessions) lives; a dedicated admin profile page
// would just duplicate it.
export const PROFILE_LINK_BY_ROLE: Record<string, string | undefined> = {
  customer: "/profile",
  driver: "/dashboard/driver/profile",
  restaurant_owner: "/dashboard/restaurant/profile",
  restaurant_staff: "/dashboard/restaurant/profile",
  admin: "/profile",
  super_admin: "/profile",
};
