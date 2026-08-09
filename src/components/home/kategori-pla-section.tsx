import { useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Home page's "Kategori Pla" discovery rail — added post-P10, sourced from
 * the `Kategori/` asset drop (10 dish photos, see
 * docs/HOME_KATEGORI_PLA_VIDEO_REPORT.md for the full asset audit). Names
 * and taglines below are taken directly from the source filenames (each
 * one already carried a real Haitian dish name and a short French
 * description, e.g. `haiti-1-soup-joumou-symbole-de-liberte-*.webp`) —
 * translated to Kreyòl to match the rest of the site's voice, not
 * invented. `dishType` only set where it genuinely matches an existing
 * `DISH_TYPES` key in popular-dishes-section.tsx (5 of 10) — clicking
 * those cards reuses that section's real filter instead of pretending a
 * category system exists where it doesn't.
 */
export type Kategori = {
  key: string;
  name: string;
  tagline: string;
  image: string;
  /** Matches a DISH_TYPES key in popular-dishes-section.tsx, when a real one exists. */
  dishType?: string;
};

export const KATEGORI_PLA: Kategori[] = [
  {
    key: "soup-joumou",
    name: "Soup Joumou",
    tagline: "Senbòl endepandans",
    image: "/kategori/haiti-1-soup-joumou-symbole-de-liberte-1739209611.webp",
    dishType: "soup",
  },
  {
    key: "diri-sos-pwa",
    name: "Diri Blan ak Sòs Pwa",
    tagline: "Manje chak jou",
    image: "/kategori/haiti-2-diri-blan-sos-pwa-legim-l039essence-du-quotidien-1739209664.webp",
    dishType: "diri_sos",
  },
  {
    key: "ragou",
    name: "Ragou",
    tagline: "Rekonfòtan e epise",
    image: "/kategori/haiti-7-ragou-un-plat-reconfortant-et-epice-1739210329.webp",
  },
  {
    key: "diri-pwa-kongo",
    name: "Diri ak Sòs Pwa Kongo",
    tagline: "Melanj gou pafè",
    image: "/kategori/haiti-9-diri-sos-pwa-kongo-un-mariage-parfait-de-saveurs--1739210578.webp",
    dishType: "diri_sos",
  },
  {
    key: "mayi-moulen",
    name: "Mayi Moulen ak Sòs Pwa",
    tagline: "Rekonfòtan",
    image: "/kategori/haiti-10-mayi-moulen-ak-sos-pwa-un-plat-reconfortant--1739210703.webp",
  },
  {
    key: "fritay",
    name: "Fritay",
    tagline: "Snack ri Ayisyen",
    image: "/kategori/haiti-11-fritay-le-snack-incontournable-des-rues-haitiennes--1739210736.webp",
    dishType: "fritay",
  },
  {
    key: "tonmtonm",
    name: "Tonmtonm ak Sòs Kalalou",
    tagline: "Espesyalite Grandsid",
    image:
      "/kategori/haiti-12-tonmtonm-ak-sos-kalalou-une-specialite-du-grand-sud--1739210770.webp",
  },
  {
    key: "lalo",
    name: "Lalo",
    tagline: "Legim tradisyonèl",
    image: "/kategori/haiti-16-lalo-l-epinard-haitien--1739211070.webp",
  },
  {
    key: "pate-kode",
    name: "Patè Kòde",
    tagline: "Street food pa ekselans",
    image: "/kategori/haiti-17-pate-kode-le-street-food-par-excellence--1739211190.webp",
  },
  {
    key: "pwason-gro-sel",
    name: "Pwason Gro Sèl",
    tagline: "Gou lanmè otantik",
    image:
      "/kategori/haiti-21-pwason-gro-sel-l-authenticite-des-saveurs-de-la-mer--1739211784.webp",
    dishType: "pwason",
  },
];

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
