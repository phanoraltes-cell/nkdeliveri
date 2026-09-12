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
import { useDeliveryFee } from "@/hooks/useDeliveryFee";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { reportDegradation } from "@/lib/report-error";

const PAGE_SIZE = 24;

// Refonte Frontend Premium, Phase 5 (P5) — sort control from the redesign
// spec's wireframe ("tri pertinence/note/délai"). No separate "pertinence"
// option: this app has no text-relevance scoring (search is a plain
// ilike filter), so "note" already *is* the existing default order —
// offering both would just be two labels for the same query. "rating" is
// that default; "prep_time" is the one genuinely different ordering the
// redesign asked for.
type SortKey = "rating" | "prep_time";

const listQuery = (q: string, page: number, sort: SortKey) =>
  queryOptions({
    queryKey: ["restaurants-all", q, page, sort],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      // Tach 1, Objektif A — konvèti nan yon RPC (list_restaurants_public)
      // paske PostgREST pa ka triye pa rezilta yon fonksyon SQL abitrè
      // (is_restaurant_open). Prezève EGZAKTEMAN menm konpòtman ansyen
      // kòd la (rechèch pa non, 2 tri, paj, kantite total) — sèl ajout la
      // se "louvri anvan fèmen" kòm tri prensipal + `is_open_now` pou
      // montre yon badj "Fèmen" nan chak kat.
      const { data, error } = await supabase.rpc("list_restaurants_public", {
        _search: q.trim() || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: from,
      });
      // DEGRADE, PA KRAZE. Anvan, yon sèl ti pàn Supabase te fè chajè a
      // echwe, epi paj sa a — ki nan sitemap la ak priyorite 0.9 — te sòti
      // an 500 nèt. Kounye a li rete lizib epi li di verite a.
      //
      // Konpwomi a se pa yon detay: yon 500 di Google « tounen pita, kenbe
      // sa ou genyen an », pandan yon 200 vid ka fè l ranplase yon bon paj
      // ak yon paj san anyen. Nou PA mete `noindex` pou otan — sa ta yon
      // siyal RETIRE, pi mal toujou pou yon pàn ki pase. Se menm kontra ak
      // dakèy la.
      if (error) {
        reportDegradation("[restaurants] list_restaurants_public failed", error);
        return { rows: [], totalCount: 0, degraded: true };
      }
      const rows = data ?? [];
      const totalCount = rows[0]?.total_count ?? 0;
      return { rows, totalCount, degraded: false };
    },
  });

const searchSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  sort: z.enum(["rating", "prep_time"]).optional(),
});

export const Route = createFileRoute("/restaurants/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    q: search.q ?? "",
    page: search.page ?? 1,
    sort: search.sort ?? "rating",
  }),
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
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(listQuery(deps.q, deps.page, deps.sort)),
  component: RestaurantsPage,
});

function RestaurantsPage() {
  const { q, page, sort } = Route.useSearch();
  const { data, refetch } = useSuspenseQuery(listQuery(q ?? "", page ?? 1, sort ?? "rating"));
  const { rows, totalCount, degraded } = data;
  const { isFavorite, toggleFavorite, isLoggedIn } = useFavorites();
  const nav = useNavigate();
  const navSearch = Route.useNavigate();

  // NKD-015: platform-wide fee (admin-set), not restaurant-set — both
  // r.delivery_fee (main list) and s.restaurant_delivery_fee (sponsored
  // cards) no longer reflect the real charged fee since
  // create_order_secure stopped reading restaurants.delivery_fee.
  const deliveryFee = useDeliveryFee();

  function updateSearch(next: { q?: string; page?: number; sort?: SortKey }) {
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
          className="mb-4 w-full max-w-[400px] rounded-full border-2 border-brand-soft bg-white px-5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">Triye pa</span>
          <Chip
            selected={(sort ?? "rating") === "rating"}
            onClick={() => updateSearch({ sort: "rating", page: 1 })}
          >
            Pi popilè
          </Chip>
          <Chip
            selected={sort === "prep_time"}
            onClick={() => updateSearch({ sort: "prep_time", page: 1 })}
          >
            Pi rapid
          </Chip>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {rows.map((r, i) => (
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
                  // P8 — see the identical comment on the sponsored grid
                  // above; same LCP reasoning applies to this grid's own
                  // first row (it's the very first content on the page
                  // when there's no sponsored section above it).
                  loading={i < 4 ? undefined : "lazy"}
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
                {/* Tach 1, Objektif A — pòtay louvri/fèmen manyèl pwopriyetè a. */}
                {!r.is_open_now && (
                  <span className="absolute left-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-bold uppercase text-white shadow-md">
                    Fèmen
                  </span>
                )}
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
                  {deliveryFee.data != null && <span>{formatHTG(deliveryFee.data)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
        {/* De ka diferan ki t ap parèt menm jan anvan. « Pa gen restoran ki
            koresponn » sou yon pàn ta yon manti: li di rechèch la pa bay
            anyen, pandan se sistèm nan ki desann. */}
        {degraded ? (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-8 text-center shadow-brand-xs">
            <p className="font-bold text-ink">Nou pa rive chaje lis restoran yo</p>
            <p className="mt-2 text-sm text-ink-soft">
              Se yon pwoblèm bò kote nou, se pa ou. Eseye ankò nan kèk moman.
            </p>
            <Button className="mt-4" onClick={() => void refetch()}>
              Eseye ankò
            </Button>
          </div>
        ) : (
          rows.length === 0 && (
            <div className="rounded-2xl border border-brand-soft/60 bg-white p-8 text-center text-ink-soft shadow-brand-xs">
              Pa gen restoran ki koresponn.
            </div>
          )
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
