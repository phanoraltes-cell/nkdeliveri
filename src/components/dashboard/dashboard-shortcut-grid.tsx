import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

export type DashboardShortcutItem = {
  icon: LucideIcon;
  title: string;
  desc: string;
  /** A route path, or null for a placeholder tile that isn't built yet ("Byento"). */
  to: string | null;
};

/**
 * The "quick links" tile grid duplicated near-identically across the
 * admin/driver/restaurant dashboard home pages — same card shell, same
 * "Ouvri →"/"Byento" convention, only the list of tiles differed.
 */
export function DashboardShortcutGrid({ items }: { items: DashboardShortcutItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        const card = (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
              <Icon className="h-5 w-5" />
            </div>
            <div className="font-display text-base font-bold text-ink">{item.title}</div>
            <div className="mt-1 text-sm text-ink-soft">{item.desc}</div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-deep">
              {item.to ? "Ouvri →" : "Byento"}
            </div>
          </div>
        );
        return item.to ? (
          <Link key={item.title} to={item.to} className="block">
            {card}
          </Link>
        ) : (
          <div key={item.title}>{card}</div>
        );
      })}
    </div>
  );
}
