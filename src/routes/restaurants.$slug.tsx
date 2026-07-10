import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatHTG } from "@/lib/format";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";
import { Plus, ArrowLeft, Star } from "lucide-react";
import { useState } from "react";
import { pageMeta, noIndexMeta, jsonLdScript } from "@/lib/seo";
import { SITE_URL, PRIMARY_CITY, absoluteUrl } from "@/lib/site-config";
import { Breadcrumb } from "@/components/breadcrumb";

const restQuery = (slug: string) =>
  queryOptions({
    queryKey: ["restaurant", slug],
    queryFn: async () => {
      const { data: r } = await supabase
        .from("restaurants")
        .select("*")
        .eq("slug", slug)
        .eq("status", "approved")
        .maybeSingle();
      if (!r) return null;
      const { data: cats } = await supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", r.id)
        .order("sort_order");
      const { data: prods } = await supabase
        .from("products")
        .select("*")
        .eq("restaurant_id", r.id)
        .eq("available", true);
      return { r, cats: cats ?? [], prods: prods ?? [] };
    },
  });

export const Route = createFileRoute("/restaurants/$slug")({
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(restQuery(params.slug));
    if (!d) throw notFound();
    return d;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return noIndexMeta("Restoran pa jwenn — NK Deliveri");
    const { r } = loaderData;
    const description = r.description ?? `Kòmande nan ${r.name}, livrezon rapid nan ${PRIMARY_CITY.name}.`;
    const path = `/restaurants/${r.slug}`;
    return {
      ...pageMeta({
        title: `${r.name} — NK Deliveri`,
        description,
        path,
        image: r.cover_url ?? undefined,
      }),
      scripts: [
        jsonLdScript({
          "@context": "https://schema.org",
          "@type": "Restaurant",
          name: r.name,
          description,
          image: r.cover_url ?? absoluteUrl("/nk-logo.png"),
          url: absoluteUrl(path),
          servesCuisine: r.cuisine ?? undefined,
          telephone: r.phone ?? undefined,
          address: {
            "@type": "PostalAddress",
            streetAddress: r.address ?? undefined,
            addressLocality: PRIMARY_CITY.name,
            addressRegion: PRIMARY_CITY.region,
            addressCountry: PRIMARY_CITY.country,
          },
          // Only publish a rating once real reviews exist — a 0/placeholder
          // rating as structured data would misrepresent the restaurant and
          // risks a Google structured-data quality violation.
          ...(r.rating != null && r.rating > 0
            ? { aggregateRating: { "@type": "AggregateRating", ratingValue: r.rating, bestRating: 5 } }
            : {}),
          ...(r.lat != null && r.lng != null
            ? { geo: { "@type": "GeoCoordinates", latitude: r.lat, longitude: r.lng } }
            : {}),
        }),
        jsonLdScript({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Akèy", item: SITE_URL },
            { "@type": "ListItem", position: 2, name: "Restoran", item: `${SITE_URL}/restaurants` },
            { "@type": "ListItem", position: 3, name: r.name, item: absoluteUrl(path) },
          ],
        }),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">Restoran pa jwenn</h1>
        <Link to="/restaurants" className="mt-4 inline-block text-brand-deep font-bold">← Retounen</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-cream p-10 text-center">Erè: {error.message}</div>
  ),
  component: RestaurantPage,
});

function RestaurantPage() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(restQuery(params.slug));
  const { add } = useCart();
  const [activeCat, setActiveCat] = useState<string>("all");
  // Must run unconditionally, before the `if (!data)` early return below —
  // calling it after would change the hook order between renders and
  // violate the Rules of Hooks (in practice `data` is never actually null
  // here since the route's loader already throws notFound() first, but the
  // hook order must not depend on that regardless).
  const restaurantId = data?.r.id;
  const reviews = useQuery({
    queryKey: ["restaurant-reviews", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("reviews")
        .select("restaurant_rating, comment, created_at")
        .eq("restaurant_id", restaurantId!)
        .not("restaurant_rating", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return rows;
    },
  });

  if (!data) return null;
  const { r, cats, prods } = data;

  // Adding a dish is category-optional ("San kategori" is the default in the
  // owner's form) — without this, any uncategorized dish matched no section
  // below and silently never appeared on the public restaurant page (it
  // still showed up on the homepage, which doesn't group by category).
  const UNCATEGORIZED = "__uncategorized__";
  const uncategorized = prods.filter((p) => p.category_id == null);
  const sections = uncategorized.length
    ? [...cats, { id: UNCATEGORIZED, name: "Lòt plat", sort_order: Infinity }]
    : cats;

  const catCounts: Record<string, number> = sections.reduce(
    (acc: Record<string, number>, c) => {
      acc[c.id] = c.id === UNCATEGORIZED ? uncategorized.length : prods.filter((p) => p.category_id === c.id).length;
      return acc;
    },
    { all: prods.length },
  );
  const visibleCats =
    activeCat === "all" ? sections : sections.filter((c) => c.id === activeCat);

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 py-6">
        <Breadcrumb items={[{ label: "Akèy", to: "/" }, { label: "Restoran", to: "/restaurants" }, { label: r.name }]} />
        <Link to="/restaurants" className="inline-flex items-center gap-1 text-sm font-bold text-brand-deep">
          <ArrowLeft className="h-4 w-4" /> Tout restoran
        </Link>
        <div className="relative mt-4 overflow-hidden rounded-[18px]">
          <img src={r.cover_url || ""} alt={r.name} width={1100} height={240} className="h-60 w-full object-cover" />
          <div className="absolute inset-0 flex items-end gap-3 bg-gradient-to-t from-ink/75 to-transparent p-6">
            {r.logo_url && (
              <img
                src={r.logo_url}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-full border-2 border-white object-cover shadow-lg"
              />
            )}
            <div>
              <h1 className="font-display text-3xl font-extrabold text-white">{r.name}</h1>
              <p className="mt-1 text-sm text-white/85">{r.cuisine} · {r.address}</p>
              <div className="mt-2 flex gap-2 text-xs">
                <span className="rounded-full bg-white/90 px-2 py-0.5 font-bold text-brand-deep">★ {Number(r.rating).toFixed(1)}</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 font-bold text-ink">{r.avg_prep_time} min</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 font-bold text-ink">Livrezon {formatHTG(Number(r.delivery_fee))}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky top-16 z-20 -mx-5 mt-8 flex flex-wrap gap-2.5 border-b border-brand-soft/60 bg-cream/95 px-5 py-3 backdrop-blur">
          {[{ id: "all", name: "Tout" }, ...sections].map((c) => {
            const active = activeCat === c.id;
            const count = catCounts[c.id] ?? 0;
            if (c.id !== "all" && count === 0) return null;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`flex items-center gap-1.5 rounded-full border-[1.5px] px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-brand-soft bg-white text-ink-soft hover:bg-brand-soft hover:text-brand-deep"
                }`}
              >
                {c.name}
                <span
                  className={`rounded-full px-1.5 text-[0.7rem] ${
                    active ? "bg-white/25 text-white" : "bg-brand-soft text-brand-deep"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {visibleCats.map((cat) => {
          const items =
            cat.id === UNCATEGORIZED ? uncategorized : prods.filter((p) => p.category_id === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mt-8">
              <h2 className="mb-4 font-display text-xl font-extrabold">{cat.name}</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
                {items.map((p) => (
                  <div key={p.id} className="flex flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
                    {p.image_url && (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        width={230}
                        height={150}
                        className="h-[150px] w-full object-cover"
                      />
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="font-display text-base font-extrabold">{p.name}</h3>
                      {p.description && <p className="mt-1 mb-2 flex-1 text-xs text-ink-soft">{p.description}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-display text-base font-extrabold text-brand-deep">{formatHTG(Number(p.price))}</span>
                        {p.stock_quantity === 0 ? (
                          <span className="rounded-full bg-ink/10 px-3 py-1.5 text-xs font-bold uppercase text-ink-soft">
                            Fini
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              const res = add({
                                productId: p.id,
                                restaurantId: r.id,
                                restaurantName: r.name,
                                name: p.name,
                                price: Number(p.price),
                                imageUrl: p.image_url,
                              });
                              if (res === "replaced") toast.info("Panye w a ranplase");
                              else toast.success(`${p.name} ajoute`);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white transition hover:scale-110 hover:bg-brand-deep"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="mt-10 border-t border-brand-soft/60 pt-6">
          <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-extrabold">
            Avi kliyan yo
            <span className="flex items-center gap-1 rounded-full bg-brand-soft/60 px-3 py-1 text-sm font-bold text-brand-deep">
              <Star className="h-4 w-4 fill-brand-deep" /> {Number(r.rating ?? 0).toFixed(1)}
            </span>
          </h2>
          {reviews.isLoading && <div className="text-sm text-ink-soft">Chajman…</div>}
          {!reviews.isLoading && (reviews.data?.length ?? 0) === 0 && (
            <div className="rounded-2xl bg-white p-6 text-center text-sm text-ink-soft shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
              Pa gen avi pou restoran sa a ankò.
            </div>
          )}
          <div className="space-y-3">
            {reviews.data?.map((rv, i) => (
              <div key={i} className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
                <div className="flex items-center justify-between">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`h-4 w-4 ${n <= (rv.restaurant_rating ?? 0) ? "fill-brand text-brand" : "text-brand-soft"}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-ink-soft">
                    {new Date(rv.created_at).toLocaleDateString("fr-HT")}
                  </span>
                </div>
                <div className="mt-1 text-xs font-bold text-ink-soft">Kliyan</div>
                {rv.comment && <p className="mt-1 text-sm text-ink">{rv.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}