import { Link } from "@tanstack/react-router";
import { ArrowRight, Heart, Star, Store } from "lucide-react";
import { formatHTG } from "@/lib/format";
import type { HomeRestaurant } from "@/components/home/home-data";
import { ImageWithFallback } from "@/components/image-with-fallback";

const CUISINES = ["Tout", "Manje Kreyòl", "Soup Joumou", "Ragou", "Lalo", "Fritay"];

type PopularRestaurantsSectionProps = {
  restaurants: HomeRestaurant[];
  cuisine: string;
  onCuisineChange: (c: string) => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (e: React.MouseEvent, restaurantId: string) => void;
};

/** Home page's "Restoran popilè" section: cuisine filter chips + a restaurant card grid. */
export function PopularRestaurantsSection({
  restaurants,
  cuisine,
  onCuisineChange,
  isFavorite,
  onToggleFavorite,
}: PopularRestaurantsSectionProps) {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-14">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-tight">
          Restoran <span className="text-brand">popilè</span>
        </h2>
        <Link
          to="/restaurants"
          className="inline-flex items-center gap-1 text-sm font-bold text-brand hover:text-brand-deep"
        >
          Wè tout <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap gap-2.5">
        {CUISINES.map((c) => (
          <button
            key={c}
            onClick={() => onCuisineChange(c)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              cuisine === c
                ? "border-brand bg-brand text-white shadow-[0_6px_16px_rgba(249,115,22,0.3)]"
                : "border-brand-soft bg-white text-ink-soft hover:border-brand hover:text-brand"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {restaurants.slice(0, 8).map((r, i) => (
          <Link
            key={r.id}
            to="/restaurants/$slug"
            params={{ slug: r.slug }}
            className="group relative overflow-hidden rounded-3xl bg-white shadow-[0_8px_24px_rgba(249,115,22,0.10)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_44px_rgba(249,115,22,0.22)]"
          >
            <div className="relative overflow-hidden">
              <ImageWithFallback
                src={r.cover_url || r.logo_url}
                alt={r.name}
                icon={Store}
                // First row (desktop: 4 cols, mobile: 2 cols) loads eagerly —
                // one of these is the likely LCP element; lazy-loading it
                // delayed the largest-contentful-paint measurement for no
                // reason since it's already above the fold on first render.
                loading={i < 4 ? "eager" : "lazy"}
                fetchPriority={i < 4 ? "high" : "auto"}
                width={280}
                height={160}
                className="h-40 w-full object-cover transition duration-500 group-hover:scale-110"
              />
              <button
                aria-label={isFavorite(r.id) ? "Retire nan favori" : "Mete an favori"}
                onClick={(e) => onToggleFavorite(e, r.id)}
                className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-md transition hover:text-brand ${
                  isFavorite(r.id) ? "text-brand" : "text-ink-soft"
                }`}
              >
                <Heart className={`h-4 w-4 ${isFavorite(r.id) ? "fill-current" : ""}`} />
              </button>
            </div>
            <div className="p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="truncate font-display text-base font-extrabold text-ink">
                  {r.name}
                </h3>
                <span className="flex items-center gap-1 rounded-full bg-brand-soft/60 px-2 py-0.5 text-xs font-bold text-brand-deep">
                  <Star className="h-3 w-3 fill-current" />
                  {Number(r.rating).toFixed(1)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <span>{r.avg_prep_time} min · Gonaïves</span>
                <span className="font-semibold text-ink">{formatHTG(Number(r.delivery_fee))}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
