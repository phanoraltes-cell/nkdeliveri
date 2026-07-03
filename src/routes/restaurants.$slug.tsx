import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatHTG } from "@/lib/format";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";
import { Plus, ArrowLeft } from "lucide-react";
import { useState } from "react";

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
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.r.name} — NK Delivery` },
          { name: "description", content: loaderData.r.description ?? `Kòmande nan ${loaderData.r.name}.` },
          { property: "og:title", content: `${loaderData.r.name} — NK Delivery` },
          { property: "og:image", content: loaderData.r.cover_url ?? "" },
        ]
      : [{ title: "Restoran pa jwenn" }, { name: "robots", content: "noindex" }],
  }),
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
  if (!data) return null;
  const { r, cats, prods } = data;

  const catCounts: Record<string, number> = cats.reduce(
    (acc: Record<string, number>, c: any) => {
      acc[c.id] = prods.filter((p: any) => p.category_id === c.id).length;
      return acc;
    },
    { all: prods.length },
  );
  const visibleCats =
    activeCat === "all" ? cats : cats.filter((c: any) => c.id === activeCat);

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 py-6">
        <Link to="/restaurants" className="inline-flex items-center gap-1 text-sm font-bold text-brand-deep">
          <ArrowLeft className="h-4 w-4" /> Tout restoran
        </Link>
        <div className="relative mt-4 overflow-hidden rounded-[18px]">
          <img src={r.cover_url || ""} alt={r.name} className="h-60 w-full object-cover" />
          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-ink/75 to-transparent p-6">
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
          {[{ id: "all", name: "Tout" }, ...cats].map((c: any) => {
            const active = activeCat === c.id;
            const count = catCounts[c.id] ?? 0;
            if (c.id !== "all" && count === 0) return null;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`flex items-center gap-1.5 rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition ${
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

        {visibleCats.map((cat: any) => {
          const items = prods.filter((p: any) => p.category_id === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mt-8">
              <h2 className="mb-4 font-display text-xl font-extrabold">{cat.name}</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
                {items.map((p: any) => (
                  <div key={p.id} className="flex flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
                    {p.image_url && <img src={p.image_url} alt={p.name} className="h-[150px] w-full object-cover" />}
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="font-display text-base font-extrabold">{p.name}</h3>
                      {p.description && <p className="mt-1 mb-2 flex-1 text-xs text-ink-soft">{p.description}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-display text-base font-extrabold text-brand-deep">{formatHTG(Number(p.price))}</span>
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <SiteFooter />
    </div>
  );
}