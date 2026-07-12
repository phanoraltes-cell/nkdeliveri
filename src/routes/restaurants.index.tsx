import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatHTG } from "@/lib/format";
import { useFavorites } from "@/hooks/useFavorites";
import { pageMeta, jsonLdScript } from "@/lib/seo";
import { SITE_URL } from "@/lib/site-config";
import { Breadcrumb } from "@/components/breadcrumb";

const listQuery = queryOptions({
  queryKey: ["restaurants-all"],
  queryFn: async () => {
    const { data } = await supabase
      .from("restaurants")
      .select("id,slug,name,cuisine,logo_url,cover_url,rating,avg_prep_time,delivery_fee,address")
      .eq("status", "approved")
      .order("rating", { ascending: false });
    return data ?? [];
  },
});

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/restaurants/")({
  validateSearch: searchSchema,
  head: () => ({
    ...pageMeta({
      title: "Restoran nan Gonaïves — NK Deliveri",
      description: "Wè tout restoran ki disponib pou livrezon nan Gonaïves.",
      path: "/restaurants",
    }),
    scripts: [
      jsonLdScript({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Akèy", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Restoran", item: `${SITE_URL}/restaurants` },
        ],
      }),
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(listQuery),
  component: RestaurantsPage,
});

function RestaurantsPage() {
  const { data } = useSuspenseQuery(listQuery);
  const { q: initialQ } = Route.useSearch();
  const [q, setQ] = useState(initialQ ?? "");
  const filtered = data.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const { isFavorite, toggleFavorite, isLoggedIn } = useFavorites();
  const nav = useNavigate();

  function onToggleFavorite(e: React.MouseEvent, restaurantId: string) {
    e.preventDefault();
    if (!isLoggedIn) {
      toast.error("Ou dwe konekte pou mete yon restoran an favori");
      nav({ to: "/auth", search: { next: "/restaurants" } });
      return;
    }
    toggleFavorite(restaurantId);
  }
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 py-10">
        <Breadcrumb items={[{ label: "Akèy", to: "/" }, { label: "Restoran" }]} />
        <h1 className="mb-2 font-display text-3xl font-extrabold">Tout restoran</h1>
        <p className="mb-6 text-ink-soft">Chwazi kote w vle kòmande jodi a.</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chèche pa non…"
          className="mb-6 w-full max-w-[400px] rounded-full border-2 border-brand-soft bg-white px-5 py-2.5 text-sm outline-none focus:border-brand"
        />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {filtered.map((r) => (
            <Link
              key={r.id}
              to="/restaurants/$slug"
              params={{ slug: r.slug }}
              className="overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(194,90,5,0.10)] transition hover:-translate-y-1"
            >
              <div className="relative">
                <img
                  src={r.cover_url || ""}
                  alt={r.name}
                  loading="lazy"
                  width={240}
                  height={144}
                  className="h-36 w-full object-cover"
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
                <h3 className="font-display text-base font-extrabold">{r.name}</h3>
                <p className="mt-1 text-xs text-ink-soft">
                  {r.cuisine} · {r.address}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-soft">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand-deep">
                    ★ {Number(r.rating).toFixed(1)}
                  </span>
                  <span>{r.avg_prep_time} min</span>
                  <span>{formatHTG(Number(r.delivery_fee))}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
