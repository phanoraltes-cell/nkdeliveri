import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatHTG } from "@/lib/format";

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

export const Route = createFileRoute("/restaurants/")({
  head: () => ({
    meta: [
      { title: "Restoran nan Gonaïves — NK Deliveri" },
      { name: "description", content: "Wè tout restoran ki disponib pou livrezon nan Gonaïves." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(listQuery),
  component: RestaurantsPage,
});

function RestaurantsPage() {
  const { data } = useSuspenseQuery(listQuery);
  const [q, setQ] = useState("");
  const filtered = data.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[1100px] px-5 py-10">
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
              <img
                src={r.cover_url || ""}
                alt={r.name}
                loading="lazy"
                className="h-36 w-full object-cover"
              />
              <div className="p-4">
                <h3 className="font-display text-base font-extrabold">{r.name}</h3>
                <p className="mt-1 text-xs text-ink-soft">{r.cuisine} · {r.address}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-soft">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand-deep">★ {Number(r.rating).toFixed(1)}</span>
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