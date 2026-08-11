import { useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { KATEGORI_PLA } from "./kategori-pla-section.data";

type KategoriPlaSectionProps = {
  /** Always called on click — with the matched DISH_TYPES key, or "all" as
   * an honest neutral fallback for the categories that don't have a real
   * match yet, rather than leaving a stale/unrelated filter active. */
  onCategoryClick: (dishType: string) => void;
};

/** Home page's "Kategori Pla" section — a horizontal discovery rail
 * immediately after the Hero. Same rail at every breakpoint (no grid/rail
 * breakpoint switch): 10 cards don't need a responsive column count, and
 * a rail keeps the section to one compact row instead of growing tall on
 * narrow screens. */
export function KategoriPlaSection({ onCategoryClick }: KategoriPlaSectionProps) {
  const railRef = useRef<HTMLDivElement>(null);

  function scrollRail(direction: 1 | -1) {
    const el = railRef.current;
    if (!el) return;
    // ~2 cards per click on desktop — matches the visible card width
    // (190px) + gap (16px) used below.
    el.scrollBy({ left: direction * 412, behavior: "smooth" });
  }

  return (
    <section aria-label="Kategori Pla" className="mx-auto max-w-[1200px] px-5 py-12">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-tight">
            Kategori <span className="text-brand">Pla</span>
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Dekouvri gou peyi a, yon plat alafwa.</p>
        </div>
        {/* Desktop-only scroll affordance — horizontal scroll isn't always
            obvious on a trackpad/mouse the way a touch swipe is on mobile. */}
        <div className="hidden shrink-0 gap-2 md:flex">
          <button
            type="button"
            onClick={() => scrollRail(-1)}
            aria-label="Fè defile kategori yo agoch"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-soft bg-white text-ink-soft transition hover:border-brand hover:text-brand-deep"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollRail(1)}
            aria-label="Fè defile kategori yo adwat"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-soft bg-white text-ink-soft transition hover:border-brand hover:text-brand-deep"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={railRef}
        className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {KATEGORI_PLA.map((k, i) => (
          <motion.button
            key={k.key}
            type="button"
            onClick={() => onCategoryClick(k.dishType ?? "all")}
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
            className="group relative w-[150px] shrink-0 snap-start overflow-hidden rounded-3xl bg-white text-left shadow-brand-xs ring-1 ring-brand-soft/40 transition hover:-translate-y-1 hover:shadow-brand-md sm:w-[170px] md:w-[190px]"
          >
            <div className="aspect-square overflow-hidden">
              <img
                src={k.image}
                alt={k.name}
                loading={i < 4 ? "eager" : "lazy"}
                width={220}
                height={220}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
              />
            </div>
            <div className="p-3">
              <h3 className="truncate font-display text-sm font-extrabold text-ink">{k.name}</h3>
              <p className="truncate text-xs text-ink-soft">{k.tagline}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
