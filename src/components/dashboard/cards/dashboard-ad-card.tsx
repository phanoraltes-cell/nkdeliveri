import { Megaphone } from "lucide-react";
import { useActivePlacements } from "@/hooks/useActivePlacements";

/** Phase 6 of the admin evolution plan: single small sponsored card for partner dashboards — never a takeover, max 1 card. */
export function DashboardAdCard() {
  const placements = useActivePlacements("dashboard", 1);
  const ad = placements.data?.[0];
  if (!ad) return null;

  const href =
    ad.link_url ?? (ad.restaurant_slug ? `/restaurants/${ad.restaurant_slug}` : undefined);

  const content = (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-brand-xs transition hover:shadow-brand-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
            Piblisite
          </span>
          <div className="mt-1 font-display text-base font-extrabold text-ink">{ad.title}</div>
          {ad.description && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{ad.description}</p>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200/70 text-amber-800">
          <Megaphone className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );

  return href ? (
    <a href={href} className="block">
      {content}
    </a>
  ) : (
    content
  );
}
