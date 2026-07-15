import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Store, ShoppingBag, ClipboardList, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";

const HIDDEN_PREFIXES = ["/dashboard", "/auth"];

/**
 * Fixed bottom tab bar shown on mobile only (md:hidden). Hidden on
 * /dashboard (has its own role-based nav) and /auth (focused task screen) to
 * avoid a redundant second nav, matching native-app tab bar conventions.
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const { count } = useCart();

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const items = [
    { to: "/", label: "Akèy", icon: Home, exact: true },
    { to: "/restaurants", label: "Restoran", icon: Store },
    { to: "/checkout", label: "Panye", icon: ShoppingBag, badge: count },
    { to: "/orders", label: "Kòmand", icon: ClipboardList },
    {
      to: user ? "/dashboard" : "/auth",
      label: user ? "Pwofil" : "Konekte",
      icon: UserIcon,
    },
  ] as const;

  return (
    <>
      {/* Spacer: reserves scroll space so page content clears the fixed bar below */}
      <div className="h-[calc(4rem+var(--sab))] md:hidden" aria-hidden="true" />
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-brand-soft/60 bg-white/95 pb-[var(--sab)] pl-[max(0px,var(--sal))] pr-[max(0px,var(--sar))] backdrop-blur md:hidden"
        aria-label="Navigasyon prensipal"
      >
        <div className="mx-auto flex h-16 max-w-[640px] items-stretch">
          {items.map((it) => {
            const Icon = it.icon;
            const badge = "badge" in it ? it.badge : 0;
            return (
              <Link
                key={it.to}
                to={it.to}
                activeOptions={"exact" in it ? { exact: it.exact } : undefined}
                activeProps={{ className: "!text-brand" }}
                className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-ink-soft transition-colors"
              >
                <span className="relative flex h-7 w-7 items-center justify-center">
                  <Icon className="h-6 w-6" />
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-white">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-[0.65rem] font-semibold leading-none">
                  {it.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
