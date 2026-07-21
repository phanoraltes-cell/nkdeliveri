import { motion } from "framer-motion";
import { Search, Clock, MapPin, Store, UtensilsCrossed, ShieldCheck, Banknote } from "lucide-react";

const heroLivreur = "/hero-livreur.jpg";

const HERO_STATS = [
  { n: "10+", l: "Restoran", Icon: Store },
  { n: "50+", l: "Plat disponib", Icon: UtensilsCrossed },
  { n: "30 min", l: "Livrezon mwayèn", Icon: Clock },
  { n: "Sekirite", l: "Peman an sekirite", Icon: ShieldCheck },
];

type HeroSectionProps = {
  q: string;
  onQChange: (value: string) => void;
  onSearch: (e: React.FormEvent) => void;
};

/** Home page's full-width hero: background image, heading, search bar, stats row, and payment badge. */
export function HeroSection({ q, onQChange, onSearch }: HeroSectionProps) {
  return (
    <section className="relative min-h-[600px] overflow-hidden md:min-h-[700px]">
      {/* Background image — the NK delivery person */}
      <img
        src={heroLivreur}
        alt=""
        aria-hidden="true"
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover object-[70%_15%]"
      />
      {/* Dark gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/25 md:from-black/75 md:via-black/50 md:to-transparent" />

      <div className="relative z-10 mx-auto max-w-[1200px] px-5 pt-28 pb-14 md:pt-36 md:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl"
        >
          {/* Badge */}
          <span className="mb-5 inline-block rounded-full bg-brand px-4 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-white shadow-[0_4px_16px_rgba(249,115,22,0.4)]">
            Livre lakay ou nan Gonaïves
          </span>

          {/* Heading */}
          <h1 className="mb-5 font-display text-[clamp(2.4rem,5vw,4rem)] font-extrabold leading-[1.05] tracking-tight text-white">
            Manje lakay,
            <br />
            <span className="text-brand">livre lakay ou</span>
          </h1>

          {/* Subtitle */}
          <p className="mb-8 max-w-[46ch] text-[15px] leading-relaxed text-white/80">
            Kòmande manje kreyòl otantik nan meyè restoran Gonaïves yo epi resevwa l cho lakay ou
            nan mwens pase 45 minit.
          </p>

          {/* Search bar */}
          <form
            onSubmit={onSearch}
            className="flex max-w-[520px] items-center rounded-full bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.25)] ring-1 ring-white/20"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-soft">
              <MapPin className="h-5 w-5" />
            </span>
            <input
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              placeholder="Chèche yon restoran oswa yon plat…"
              aria-label="Chèche yon restoran oswa yon plat…"
              // min-w-0 overrides the browser's default intrinsic min-width
              // on text inputs — without it, a flex-1 input refuses to
              // shrink below its content width on narrow screens and pushes
              // the submit button out past the pill's right edge.
              className="min-w-0 flex-1 rounded-full bg-transparent px-2 py-3 text-sm outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <button
              type="submit"
              className="flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(249,115,22,0.4)] transition hover:bg-brand-deep hover:shadow-[0_12px_28px_rgba(249,115,22,0.5)]"
            >
              <Search className="h-4 w-4" /> Chèche
            </button>
          </form>

          {/* Stats row — 4 items */}
          <div className="mt-8 flex flex-wrap gap-6 md:gap-8">
            {HERO_STATS.map((s) => (
              <div key={s.l} className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-brand backdrop-blur-sm">
                  <s.Icon className="h-5 w-5" />
                </span>
                <div>
                  <b className="block font-display text-xl font-extrabold text-white">{s.n}</b>
                  <span className="block text-xs text-white/70">{s.l}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Payment badge — bottom right */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.15)] backdrop-blur sm:gap-x-3 sm:px-5 sm:py-3 md:absolute md:right-8 md:bottom-8 md:mt-0 md:flex-nowrap"
        >
          <span className="text-xs font-semibold whitespace-nowrap text-ink sm:text-sm">
            Peman disponib
          </span>
          <div className="flex h-8 w-16 shrink-0 items-center justify-center sm:w-24">
            <img
              src="/moncash-logo-hero.png"
              alt="MonCash"
              width={64}
              height={32}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
          <div className="flex h-8 w-16 shrink-0 items-center justify-center gap-1 rounded border border-brand-soft/60 bg-white sm:w-24 sm:gap-1.5">
            <Banknote
              className="h-3.5 w-3.5 shrink-0 text-brand-deep sm:h-4 sm:w-4"
              aria-hidden="true"
            />
            <span className="text-[0.7rem] font-bold text-ink sm:text-xs">Kach</span>
          </div>
          <div className="flex h-8 w-16 shrink-0 items-center justify-center sm:w-24">
            <img
              src="/natcash-logo-new.png"
              alt="NatCash"
              width={64}
              height={32}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
