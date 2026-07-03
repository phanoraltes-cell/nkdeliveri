import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatHTG } from "@/lib/format";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";
import {
  Search,
  Clock,
  CreditCard,
  Plus,
  Store,
  UtensilsCrossed,
  Wallet,
  Bike,
  Heart,
  Star,
  Layers,
  Timer,
  ShieldCheck,
  Headphones,
  ArrowRight,
} from "lucide-react";
import heroLivreur from "@/assets/hero-livreur.jpg.asset.json";
import chefImg from "@/assets/chef.jpg.asset.json";
import scooterImg from "@/assets/scooter.jpg.asset.json";
import phoneMockup from "@/assets/phone-mockup.jpg.asset.json";

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
        .select("id,name,description,price,image_url,dish_type,restaurant_id,restaurants(name,slug)")
        .eq("popular", true)
        .eq("available", true)
        .limit(16),
    ]);
    return { restaurants: rests.data ?? [], products: (prods.data ?? []) as any[] };
  },
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeDataQuery),
  component: Index,
});

const CUISINES = ["Tout", "Manje Kreyòl", "Soup Joumou", "Ragou", "Lalo", "Fritay"];

const DISH_TYPES: { key: string; label: string; emoji: string }[] = [
  { key: "all", label: "Tout", emoji: "\n" },
  { key: "diri_sos", label: "Diri ak Sòs", emoji: "🍚" },
  { key: "griyo", label: "Griyo", emoji: "🍖" },
  { key: "fritay", label: "Fritay", emoji: "🍤" },
  { key: "soup", label: "Soup", emoji: "🥣" },
  { key: "pwason", label: "Pwason", emoji: "🐟" },
  { key: "sandwich", label: "Sandwich", emoji: "🥪" },
  { key: "pizza", label: "Pizza", emoji: "🍕" },
  { key: "bwason", label: "Bwason", emoji: "🥤" },
];

const HOW_STEPS = [
  { icon: Store, title: "Chwazi restoran", desc: "Dekouvri meyè restoran nan zòn ou." },
  { icon: UtensilsCrossed, title: "Chwazi sa w vle", desc: "Ajoute plat ou renmen yo nan panyen an." },
  { icon: Wallet, title: "Peye fasil", desc: "Peye an sekirite ak MonCash oswa Kat." },
  { icon: Bike, title: "Resevwa l rapid", desc: "Livrezon cho e rapid jis lakay ou." },
];

const APP_BENEFITS = [
  { icon: Layers, title: "Plis chwa", desc: "Yon gwo seleksyon restoran ak plat pou tout gou." },
  { icon: Timer, title: "Livrezon rapid", desc: "Nou garanti livrezon nan mwens pase 45 minit." },
  { icon: ShieldCheck, title: "Peman sekirite", desc: "Peye fasil ak MonCash, Kat oswa lajan kach." },
  { icon: Headphones, title: "Sipò 24/7", desc: "Nou la pou ede w nenpòt lè w bezwen nou." },
];

function Index() {
  const { data } = useSuspenseQuery(homeDataQuery);
  const [cuisine, setCuisine] = useState("Tout");
  const [dishType, setDishType] = useState("all");
  const [q, setQ] = useState("");
  const { add } = useCart();

  const restaurants = data.restaurants.filter(
    (r) =>
      (cuisine === "Tout" || r.cuisine === cuisine) &&
      r.name.toLowerCase().includes(q.toLowerCase()),
  );

  const filteredProducts = data.products.filter(
    (p: any) => dishType === "all" || p.dish_type === dishType,
  );
  const dishCounts = DISH_TYPES.reduce<Record<string, number>>((acc, d) => {
    acc[d.key] =
      d.key === "all"
        ? data.products.length
        : data.products.filter((p: any) => p.dish_type === d.key).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_10%_0%,rgba(254,215,170,0.55),transparent_60%)]" />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-10 px-5 pt-10 pb-16 md:grid-cols-2 md:pt-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="mb-5 inline-block rounded-full bg-brand-soft/70 px-4 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-brand-deep">
              Livre lakay ou nan Gonaïves
            </span>
            <h1 className="mb-5 font-display text-[clamp(2.4rem,5vw,4rem)] font-extrabold leading-[1.05] tracking-tight text-ink">
              Manje lakay,
              <br />
              <span className="text-brand">livre lakay ou</span>
            </h1>
            <p className="mb-8 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
              Kòmande manje kreyòl otantik nan meyè restoran Gonaïves yo epi
              resevwa l cho lakay ou nan mwens pase 45 minit.
            </p>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex max-w-[520px] items-center rounded-full bg-white p-1.5 shadow-[0_16px_40px_rgba(249,115,22,0.15)] ring-1 ring-brand-soft/60"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chèche yon restoran oswa yon plat…"
                className="flex-1 rounded-full bg-transparent px-5 py-3 text-sm outline-none placeholder:text-ink-soft"
              />
              <button
                type="submit"
                className="flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(249,115,22,0.4)] transition hover:bg-brand-deep hover:shadow-[0_12px_28px_rgba(249,115,22,0.5)]"
              >
                <Search className="h-4 w-4" /> Chèche
              </button>
            </form>
            <div className="mt-8 flex flex-wrap gap-8">
              {[
                { n: "10+", l: "Restoran", Icon: Store },
                { n: "50+", l: "Plat disponib", Icon: UtensilsCrossed },
                { n: "30 min", l: "Livrezon mwayèn", Icon: Clock },
              ].map((s) => (
                <div key={s.l} className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft/60 text-brand-deep">
                    <s.Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <b className="block font-display text-xl font-extrabold text-ink">
                      {s.n}
                    </b>
                    <span className="block text-xs text-ink-soft">{s.l}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="relative"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <img
              src={heroLivreur.url}
              alt="Livrè NK Delivery"
              width={1024}
              height={1024}
              className="aspect-square w-full rounded-[32px] object-cover shadow-[0_30px_80px_rgba(249,115,22,0.3)]"
            />
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute right-4 top-6 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
            >
              <CreditCard className="h-4 w-4 text-brand" /> MonCash · Kat
            </motion.div>
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute -left-3 bottom-8 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
            >
              <Clock className="h-4 w-4 text-brand" /> 25-30 min
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-[1200px] px-5 py-14">
        <h2 className="mb-10 text-center font-display text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold tracking-tight">
          Kijan li <span className="text-brand">travay</span> ?
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative rounded-3xl bg-white p-6 text-center shadow-[0_8px_28px_rgba(249,115,22,0.08)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(249,115,22,0.18)]"
            >
              <span className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-extrabold text-white">
                {i + 1}
              </span>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft/50 text-brand transition group-hover:scale-110 group-hover:bg-brand group-hover:text-white">
                <s.icon className="h-8 w-8" />
              </div>
              <h3 className="mb-1.5 font-display text-lg font-extrabold text-ink">
                {s.title}
              </h3>
              <p className="text-sm text-ink-soft">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* RESTAURANT BANNER */}
      <section className="mx-auto max-w-[1200px] px-5 pb-14">
        <div className="relative grid overflow-hidden rounded-[32px] bg-brand text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.4fr_1fr]">
          <div className="relative z-10 p-8 md:p-12">
            <h2 className="mb-3 font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-extrabold leading-tight">
              Ou restoran ?
            </h2>
            <p className="mb-6 max-w-[38ch] text-white/90">
              Fè biznis ou grandi ak NK Delivery epi rive jwenn plis kliyan chak jou.
            </p>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-extrabold text-brand-deep shadow-lg transition hover:scale-[1.03] hover:bg-cream"
            >
              Enskri restoran ou <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative">
            <img
              src={chefImg.url}
              alt="Chef NK Delivery"
              loading="lazy"
              width={1024}
              height={768}
              className="h-full w-full object-cover object-center md:absolute md:inset-0"
            />
          </div>
        </div>
      </section>

      {/* POPULAR RESTAURANTS */}
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
              onClick={() => setCuisine(c)}
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
          {restaurants.slice(0, 8).map((r) => (
            <Link
              key={r.id}
              to="/restaurants/$slug"
              params={{ slug: r.slug }}
              className="group relative overflow-hidden rounded-3xl bg-white shadow-[0_8px_24px_rgba(249,115,22,0.10)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_44px_rgba(249,115,22,0.22)]"
            >
              <div className="relative overflow-hidden">
                <img
                  src={r.cover_url || r.logo_url || ""}
                  alt={r.name}
                  loading="lazy"
                  className="h-40 w-full object-cover transition duration-500 group-hover:scale-110"
                />
                <button
                  aria-label="Favori"
                  onClick={(e) => e.preventDefault()}
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-ink-soft shadow-md transition hover:text-brand"
                >
                  <Heart className="h-4 w-4" />
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
                  <span className="font-semibold text-ink">
                    {formatHTG(Number(r.delivery_fee))}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* MOBILE APP SECTION */}
      <section className="mx-auto max-w-[1200px] px-5 pb-14">
        <div className="grid items-center gap-10 rounded-[32px] bg-white p-8 shadow-[0_10px_40px_rgba(249,115,22,0.08)] ring-1 ring-brand-soft/40 md:grid-cols-2 md:p-12">
          <div>
            <h2 className="mb-8 font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-extrabold leading-tight">
              Tout sa w bezwen,
              <br />
              <span className="text-brand">nan yon sèl aplikasyon</span>
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {APP_BENEFITS.map((b) => (
                <div key={b.title} className="flex gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft/50 text-brand">
                    <b.icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="mb-1 font-display text-base font-extrabold text-ink">
                      {b.title}
                    </h3>
                    <p className="text-sm text-ink-soft">{b.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <motion.div
            className="flex justify-center"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          >
            <img
              src={phoneMockup.url}
              alt="Aplikasyon NK Delivery"
              loading="lazy"
              width={768}
              height={1024}
              className="max-h-[520px] w-auto object-contain drop-shadow-[0_30px_40px_rgba(249,115,22,0.25)]"
            />
          </motion.div>
        </div>
      </section>

      {/* POPULAR DISHES */}
      <section className="mx-auto max-w-[1200px] px-5 pb-14">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-tight">
            Plat <span className="text-brand">popilè</span>
          </h2>
        </div>
        <div className="mb-5 flex flex-wrap gap-2.5">
          {DISH_TYPES.map((d) => {
            const active = dishType === d.key;
            const count = dishCounts[d.key] ?? 0;
            if (d.key !== "all" && count === 0) return null;
            return (
              <button
                key={d.key}
                onClick={() => setDishType(d.key)}
                className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-brand bg-brand text-white shadow-[0_6px_16px_rgba(249,115,22,0.3)]"
                    : "border-brand-soft bg-white text-ink-soft hover:border-brand hover:text-brand"
                }`}
              >
                <span aria-hidden>{d.emoji}</span>
                {d.label}
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-[0.7rem] ${
                    active ? "bg-white/25 text-white" : "bg-brand-soft/60 text-brand-deep"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {filteredProducts.slice(0, 8).map((p: any) => (
            <div
              key={p.id}
              className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_8px_24px_rgba(249,115,22,0.10)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_44px_rgba(249,115,22,0.22)]"
            >
              <div className="overflow-hidden">
                <img
                  src={p.image_url || ""}
                  alt={p.name}
                  loading="lazy"
                  className="h-40 w-full object-cover transition duration-500 group-hover:scale-110"
                />
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-display text-[0.98rem] font-extrabold text-ink">
                  {p.name}
                </h3>
                <p className="mt-1 mb-3 flex-1 text-xs text-ink-soft">
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
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_16px_rgba(249,115,22,0.35)] transition hover:scale-110 hover:bg-brand-deep"
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

      {/* NEWSLETTER */}
      <section className="mx-auto max-w-[1200px] px-5 pb-16">
        <div className="grid overflow-hidden rounded-[32px] bg-brand text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.3fr_1fr]">
          <div className="p-8 md:p-12">
            <h2 className="mb-2 font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold">
              Rete konekte ak NK Delivery+
            </h2>
            <p className="mb-6 text-white/90">
              Enskri pou resevwa promosyon, nouvote ak avantaj espesyal.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                toast.success("Mèsi! Ou enskri.");
              }}
              className="flex max-w-[460px] items-center rounded-full bg-white p-1.5"
            >
              <input
                type="email"
                required
                placeholder="Antre imèl ou"
                className="flex-1 rounded-full bg-transparent px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft"
              />
              <button className="rounded-full bg-brand-deep px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-ink">
                Enskri
              </button>
            </form>
          </div>
          <div className="relative">
            <img
              src={scooterImg.url}
              alt="Scooter NK Delivery"
              loading="lazy"
              width={1024}
              height={768}
              className="h-full w-full object-cover md:absolute md:inset-0"
            />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}