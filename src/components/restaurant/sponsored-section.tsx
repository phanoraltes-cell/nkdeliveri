import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
import { getAdAspectRatio } from "@/lib/ad-aspect-ratio";

type SponsoredSectionProps = {
  /** Excludes a restaurant advertising itself on its own page. */
  currentRestaurantId: string;
};

/** Phase 6 of the admin evolution plan: small "Peye" zone on a restaurant page, inserted into the product grid. */
export function SponsoredSection({ currentRestaurantId }: SponsoredSectionProps) {
  const placements = useActivePlacements("restaurant_page", 3);
  const rows = (placements.data ?? []).filter((s) => s.restaurant_id !== currentRestaurantId);
  if (rows.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-extrabold">
        Sponsorize
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase text-amber-800">
          Peye
        </span>
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
        {rows.map((s) => {
          const href =
            s.link_url ?? (s.restaurant_slug ? `/restaurants/${s.restaurant_slug}` : null);
          // Tach 4 — jamè koupe: VRE rapò medya a (§ ad-banner-section.tsx
          // gen menm kòmantè) olye `h-[150px]` fiks la lè dimansyon yo
          // estoke; tonbe tounen sou ansyen kad 150px la sinon.
          const ratio = getAdAspectRatio(s);
          const card = (
            <div className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-brand-xs ring-1 ring-amber-300 transition hover:-translate-y-1 hover:shadow-brand-md">
              <div
                className={
                  ratio ? "overflow-hidden bg-ink/5" : "h-[150px] overflow-hidden bg-ink/5"
                }
                style={ratio ? { aspectRatio: ratio } : undefined}
              >
                <AdMedia
                  ad={{ ...s, image_url: s.image_url ?? s.restaurant_cover_url }}
                  icon={Store}
                  loading="lazy"
                  width={s.media_width ?? 230}
                  height={s.media_height ?? 150}
                  className="h-full w-full object-contain transition duration-500 group-hover:scale-110"
                />
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-display text-base font-extrabold">{s.title}</h3>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{s.description}</p>
                )}
                {s.restaurant_name && (
                  <p className="mt-1 text-xs text-ink-soft">{s.restaurant_name}</p>
                )}
              </div>
            </div>
          );
          return href && s.restaurant_slug ? (
            <Link key={s.id} to="/restaurants/$slug" params={{ slug: s.restaurant_slug }}>
              {card}
            </Link>
          ) : href ? (
            <a key={s.id} href={href}>
              {card}
            </a>
          ) : (
            <div key={s.id}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
