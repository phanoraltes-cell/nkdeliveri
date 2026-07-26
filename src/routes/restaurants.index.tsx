import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Heart, Store } from "lucide-react";
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
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { useActivePlacements } from "@/hooks/useActivePlacements";

const PAGE_SIZE = 24;

const listQuery = (q: string, page: number) =>
  queryOptions({
    queryKey: ["restaurants-all", q, page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let query = supabase
        .from("restaurants")
        .select(
          "id,slug,name,cuisine,logo_url,cover_url,rating,avg_prep_time,delivery_fee,address",
          { count: "exact" },
        )
        .eq("status", "approved");
      // Search moved server-side alongside pagination: filtering the
      // already-fetched page client-side (as this used to) would silently
      // only search whatever page happened to be loaded.
      if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
      const { data, error, count } = await query
        .order("rating", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], totalCount: count ?? 0 };
    },
  });

const searchSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/restaurants/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ q: search.q ?? "", page: search.page ?? 1 }),
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
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(listQuery(deps.q, deps.page)),
  component: RestaurantsPage,
});

function RestaurantsPage() {
  const { q, page } = Route.useSearch();
  const { data } = useSuspenseQuery(listQuery(q ?? "", page ?? 1));
  const { rows, totalCount } = data;
  const { isFavorite, toggleFavorite, isLoggedIn } = useFavorites();
  const nav = useNavigate();
  const navSearch = Route.useNavigate();

  // Sponsored restaurants (Phase 6) only make sense at the top of an
  // unfiltered first page — showing them on page 3 of a name search would
  // read as broken relevance, not "promoted".
  const showSponsored = !q?.trim() && (page ?? 1) === 1;
  const sponsored = useActivePlacements("search_results", 2);
  const sponsoredRows = showSponsored ? (sponsored.data ?? []) : [];

  function updateSearch(next: { q?: string; page?: number }) {
    navSearch({ search: (prev) => ({ ...prev, ...next }), replace: true });
  }

  // Typing updates this immediately for a responsive input; the URL (and
  // therefore the server query) only follows after a short pause, so each
  // keystroke doesn't trigger its own fetch.
  const [inputValue, setInputValue] = useState(q ?? "");
  useEffect(() => {
    setInputValue(q ?? "");
  }, [q]);
  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed === (q ?? "").trim()) return;
    const id = setTimeout(() => updateSearch({ q: inputValue || undefined, page: 1 }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

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
      <main className="mx-auto max-w-[1100px] px-5 py-10">
        <Breadcrumb items={[{ label: "Akèy", to: "/" }, { label: "Restoran" }]} />
        <h1 className="mb-2 font-display text-3xl font-extrabold">Tout restoran</h1>
        <p className="mb-6 text-ink-soft">Chwazi kote w vle kòmande jodi a.</p>
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Chèche pa non…"
          aria-label="Chèche pa non…"
          className="mb-6 w-full max-w-[400px] rounded-full border-2 border-brand-soft bg-white px-5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        {sponsoredRows.filter((s) => s.restaurant_slug).length > 0 && (
          <>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
              Sponsorize
            </div>
            <div className="mb-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {sponsoredRows
                .filter((s) => s.restaurant_slug)
                .map((s) => (
                  <Link
                    key={s.id}
                    to="/restaurants/$slug"
                    params={{ slug: s.restaurant_slug! }}
                    className="group overflow-hidden rounded-3xl bg-white shadow-brand-xs ring-1 ring-amber-300 transition hover:-translate-y-1.5 hover:shadow-brand-md"
                  >
                    <div className="relative overflow-hidden">
                      <ImageWithFallback
                        src={s.restaurant_cover_url}
                        alt={s.restaurant_name ?? s.title}
                        icon={Store}
                        loading="lazy"
                        width={240}
                        height={144}
                        className="h-36 w-full object-cover transition duration-500 group-hover:scale-110"
                      />
                      <span className="absolute left-3 top-3 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-950 shadow-md">
                        Peye
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="font-display text-base font-extrabold">{s.restaurant_name}</h3>
                      <p className="mt-1 text-xs text-ink-soft">
                        {s.restaurant_cuisine} · {s.restaurant_address}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-soft">
                        {s.restaurant_rating != null && (
                          <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand-deep">
                            ★ {Number(s.restaurant_rating).toFixed(1)}
                          </span>
                        )}
                        {s.restaurant_avg_prep_time != null && (
                          <span>{s.restaurant_avg_prep_time} min</span>
                        )}
                        {s.restaurant_delivery_fee != null && (
                          <span>{formatHTG(Number(s.restaurant_delivery_fee))}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
            </div>
          </>
        )}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {rows.map((r) => (
            <Link
              key={r.id}
              to="/restaurants/$slug"
              params={{ slug: r.slug }}
              className="group overflow-hidden rounded-3xl bg-white shadow-brand-xs ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-brand-md"
            >
              <div className="relative overflow-hidden">
                <ImageWithFallback
                  src={r.cover_url}
                  alt={r.name}
                  icon={Store}
                  loading="lazy"
                  width={240}
                  height={144}
                  className="h-36 w-full object-cover transition duration-500 group-hover:scale-110"
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
        {rows.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-8 text-center text-ink-soft shadow-brand-xs">
            Pa gen restoran ki koresponn.
          </div>
        )}
        <PaginationControls
          page={page ?? 1}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          onPageChange={(p) => updateSearch({ page: p })}
          className="mt-6"
        />
      </main>
      <SiteFooter />
    </div>
  );
}
