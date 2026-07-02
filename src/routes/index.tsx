import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NkSmile } from "@/components/nk-smile";
import { formatHTG } from "@/lib/format";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";
import { Search, Clock, CreditCard, Plus } from "lucide-react";

const homeDataQuery = queryOptions({
  queryKey: ["home-data"],
  queryFn: async () => {
    const [rests, prods] = await Promise.all([
      supabase
        .from("restaurants")
        .select("id,slug,name,cuisine,logo_url,cover_url,rating,avg_prep_time,delivery_fee")
        .eq("status", "approved")
        .order("rating", { ascending: false })
        .limit(8),
      supabase
        .from("products")
        .select("id,name,description,price,image_url,restaurant_id,restaurants(name,slug)")
        .eq("popular", true)
        .eq("available", true)
        .limit(8),
    ]);
    return { restaurants: rests.data ?? [], products: (prods.data ?? []) as any[] };
  },
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeDataQuery),
  component: Index,
});

const CUISINES = ["Tout", "Kreyòl", "Griyo", "Pizza", "Sandwich", "Fruits de mer"];

function Index() {
  const { data } = useSuspenseQuery(homeDataQuery);
  const [cuisine, setCuisine] = useState("Tout");
  const [q, setQ] = useState("");
  const { add } = useCart();

  const restaurants = data.restaurants.filter(
    (r) =>
      (cuisine === "Tout" || r.cuisine === cuisine) &&
      r.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />

      <section className="bg-white">
        <div className="mx-auto grid max-w-[1100px] items-center gap-11 px-5 py-14 md:grid-cols-[1.05fr_.95fr]">
          <div>
            <span className="mb-4 inline-block rounded-full bg-brand-soft px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-deep">
              Livre lakay ou nan Gonaïves
            </span>
            <h1 className="mb-4 font-display text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[1.1] tracking-tight">
              Manje lakay,{" "}
              <em className="not-italic text-brand">livre lakay ou</em>
            </h1>
            <p className="mb-7 max-w-[46ch] text-ink-soft">
              Kòmande manje kreyòl otantik nan meyè restoran Gonaïves yo epi
              resevwa l cho lakay ou nan mwens pase 45 minit.
            </p>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex max-w-[480px] rounded-full border-2 border-brand-soft bg-cream p-1.5"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chèche yon restoran oswa yon plat…"
                className="flex-1 rounded-full bg-transparent px-4 py-2.5 text-sm outline-none"
              />
              <button className="flex items-center gap-1.5 rounded-full bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-deep">
                <Search className="h-4 w-4" /> Chèche
              </button>
            </form>
            <div className="mt-7 flex gap-8">
              {[
                { n: "40+", l: "Restoran" },
                { n: "500+", l: "Plat disponib" },
                { n: "30 min", l: "Livrezon mwayèn" },
              ].map((s) => (
                <div key={s.l}>
                  <b className="font-display text-2xl font-extrabold text-brand-deep">
                    {s.n}
                  </b>
                  <span className="block text-xs text-ink-soft">{s.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <img
              src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800"
              alt="Plat kreyòl"
              className="aspect-[4/3] w-full rounded-[28px] object-cover shadow-[0_24px_60px_rgba(194,90,5,0.28)]"
            />
            <div className="absolute -left-4 bottom-5 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold shadow-lg">
              <Clock className="h-4 w-4 text-brand" /> 25-30 min
            </div>
            <div className="absolute -right-3 top-5 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold shadow-lg">
              <CreditCard className="h-4 w-4 text-brand" /> MonCash · Kat
            </div>
          </div>
        </div>
        <NkSmile />
      </section>

      <section className="mx-auto max-w-[1100px] px-5 pt-8">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold tracking-tight">
            Restoran popilè
          </h2>
          <Link
            to="/restaurants"
            className="text-sm font-bold text-brand-deep hover:underline"
          >
            Wè tout →
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap gap-2.5">
          {CUISINES.map((c) => (
            <button
              key={c}
              onClick={() => setCuisine(c)}
              className={`rounded-full border-[1.5px] px-4 py-2 text-sm font-semibold transition ${
                cuisine === c
                  ? "border-brand bg-brand text-white"
                  : "border-brand-soft bg-white text-ink-soft hover:bg-brand-soft hover:text-brand-deep"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {restaurants.map((r) => (
            <Link
              key={r.id}
              to="/restaurants/$slug"
              params={{ slug: r.slug }}
              className="overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(194,90,5,0.10)] transition hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(194,90,5,0.18)]"
            >
              <img
                src={r.cover_url || r.logo_url || ""}
                alt={r.name}
                className="h-36 w-full object-cover"
              />
              <div className="p-4">
                <h3 className="font-display text-base font-extrabold">{r.name}</h3>
                <div className="mt-1.5 flex flex-wrap gap-2.5 text-xs text-ink-soft">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand-deep">
                    ★ {Number(r.rating).toFixed(1)}
                  </span>
                  <span>{r.avg_prep_time} min</span>
                  <span>{formatHTG(Number(r.delivery_fee))} livrezon</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-5 pt-10 pb-6">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold tracking-tight">
            Plat popilè
          </h2>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {data.products.map((p: any) => (
            <div
              key={p.id}
              className="flex flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(194,90,5,0.10)] transition hover:-translate-y-1"
            >
              <img
                src={p.image_url || ""}
                alt={p.name}
                className="h-[150px] w-full object-cover"
              />
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-display text-[0.98rem] font-extrabold">{p.name}</h3>
                <p className="mt-1 mb-2.5 flex-1 text-xs text-ink-soft">
                  {p.restaurants?.name}
                </p>
                <div className="flex items-center justify-between">
                  <span className="font-display text-base font-extrabold text-brand-deep">
                    {formatHTG(Number(p.price))}
                  </span>
                  <button
                    onClick={() => {
                      const res = add({
                        productId: p.id,
                        restaurantId: p.restaurant_id,
                        restaurantName: p.restaurants?.name ?? "",
                        name: p.name,
                        price: Number(p.price),
                        imageUrl: p.image_url,
                      });
                      if (res === "replaced")
                        toast.info("Panye w a ranplase — restoran diferan");
                      else toast.success(`${p.name} ajoute nan panye`);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white transition hover:scale-110 hover:bg-brand-deep"
                    aria-label="Ajoute nan panye"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}