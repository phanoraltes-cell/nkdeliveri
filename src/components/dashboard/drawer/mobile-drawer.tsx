import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, LogOut, User, LayoutGrid } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getNavItems, PROFILE_LINK_BY_ROLE } from "../sidebar/nav-items";
import { dashboardFamilies } from "@/lib/dashboard-family";

type MobileDrawerProps = {
  role: string;
  allRoles?: string[];
  employeeRole?: string | null;
  onSignOut: () => void;
};

/** Hamburger-triggered off-canvas nav for <md screens — replaces the old horizontal scrollable tab strip. */
export function MobileDrawer({ role, allRoles, employeeRole, onSignOut }: MobileDrawerProps) {
  const [open, setOpen] = useState(false);
  const items = getNavItems(role, employeeRole);
  const profileLink = PROFILE_LINK_BY_ROLE[role];
  const families = dashboardFamilies(allRoles ?? [role]);
  const activeFamilyTo = dashboardFamilies([role])[0]?.to;

  function closeAnd(action?: () => void) {
    setOpen(false);
    action?.();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Louvri meni"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-soft bg-white text-ink md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col gap-0 bg-cream p-0 sm:max-w-[280px]"
      >
        <SheetHeader className="border-b border-brand-soft/50 p-4 text-left">
          <SheetTitle asChild>
            <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2">
              <img
                src="/nk-logo.png"
                alt="NK"
                width={32}
                height={32}
                loading="lazy"
                className="h-8 w-8 rounded-full"
              />
              <span className="font-display text-base font-extrabold text-ink">
                NK <span className="text-brand">Deliveri</span>
              </span>
            </Link>
          </SheetTitle>
        </SheetHeader>

        {families.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-brand-soft/40 p-3">
            {families.map((f) => (
              <Link
                key={f.to}
                to={f.to}
                onClick={() => setOpen(false)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  f.to === activeFamilyTo
                    ? "bg-brand-deep text-white"
                    : "bg-brand-soft/50 text-ink hover:bg-brand-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        )}

        <nav
          aria-label="Navigasyon dashboard"
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const sectionHeading =
              item.section !== items[i - 1]?.section ? item.section : undefined;
            return (
              <div key={item.to}>
                {sectionHeading && (
                  <div className="mt-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft first:mt-0">
                    {sectionHeading}
                  </div>
                )}
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  activeProps={{ className: "!bg-brand-deep !text-white" }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-brand-soft/40"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              </div>
            );
          })}
          <div className="my-2 border-t border-brand-soft/40" />
          <Link
            to="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-soft hover:bg-brand-soft/30"
          >
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
            Retounen sou sit la
          </Link>
        </nav>

        <div className="flex flex-col gap-1 border-t border-brand-soft/50 p-3">
          {profileLink && (
            <Link
              to={profileLink}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-brand-soft/40"
            >
              <User className="h-4 w-4 shrink-0" aria-hidden="true" />
              Pwofil
            </Link>
          )}
          <button
            onClick={() => closeAnd(onSignOut)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-brand-soft/40"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            Dekonekte
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
