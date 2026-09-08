import { Link } from "@tanstack/react-router";
import { LogOut, User, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getNavItems, PROFILE_LINK_BY_ROLE } from "./nav-items";

type DashboardSidebarProps = {
  role: string;
  employeeRole?: string | null;
  onSignOut: () => void;
};

/**
 * Desktop-only fixed sidebar (see MobileDrawer for the <md equivalent).
 * Renders icon-only with tooltips between md and lg, full labels at lg+ —
 * this is the "sidebar réduite" tablet behavior from the spec.
 */
export function DashboardSidebar({ role, employeeRole, onSignOut }: DashboardSidebarProps) {
  const items = getNavItems(role, employeeRole);
  const profileLink = PROFILE_LINK_BY_ROLE[role];

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 border-r border-brand-soft/50 bg-white md:flex md:w-[72px] md:flex-col lg:w-[260px]">
      <TooltipProvider delayDuration={100}>
        <nav
          aria-label="Navigasyon dashboard"
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
        >
          {items.map((item, i) => (
            <SidebarLink
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              sectionHeading={item.section !== items[i - 1]?.section ? item.section : undefined}
            />
          ))}
          <div className="my-2 border-t border-brand-soft/40 lg:hidden" />
          <SidebarLink to="/" label="Retounen sou sit la" icon={LayoutGrid} muted />
        </nav>

        <div className="flex flex-col gap-1 border-t border-brand-soft/50 p-3">
          {profileLink && <SidebarLink to={profileLink} label="Pwofil" icon={User} />}
          <SidebarButton label="Dekonekte" icon={LogOut} onClick={onSignOut} />
        </div>
      </TooltipProvider>
    </aside>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  muted = false,
  sectionHeading,
}: {
  to: string;
  label: string;
  icon: typeof User;
  muted?: boolean;
  sectionHeading?: string;
}) {
  return (
    <>
      {sectionHeading && (
        <div className="mt-2 hidden px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft first:mt-0 lg:block">
          {sectionHeading}
        </div>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            activeProps={{ className: "!bg-brand-deep !text-white !shadow-brand-sm" }}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all",
              "justify-center lg:justify-start",
              muted ? "text-ink-soft hover:bg-brand-soft/30" : "text-ink hover:bg-brand-soft/40",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="lg:hidden">
          {label}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function SidebarButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof User;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-brand-soft/40 lg:justify-start"
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
