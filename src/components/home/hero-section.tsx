import { motion } from "framer-motion";
import { Search, Clock, MapPin, Store, UtensilsCrossed, ShieldCheck, Banknote } from "lucide-react";

// hero-livreur.png/webp swapped for a purpose-built 1920×800 (2.4:1)
// composition: the courier is sharp and right-anchored in roughly the
// right third, the left ~65% is the SAME scene pre-blurred/muted by the
// source asset itself (not a CSS trick) — unlike the old 1254×1254 SQUARE
// photo this replaces, object-fit:cover no longer fights the layout at
// any realistic hero aspect ratio: object-position "right" anchors the
// courier to the container's right edge and crops overflow from the
// LEFT (the pre-blurred zone, which has nothing worth keeping), so the
// courier — cap, face, "NK DELIVERI" bag, and branded backpack — stays
// fully framed at every width instead of needing a hand-tuned X%
// per breakpoint. Re-verified visually (Playwright) at every width in
// the QA list below after implementation.
const heroLivreurWebp = "/hero-livreur.webp";
const heroLivreurPng = "/hero-livreur.png";

// Why the <section>'s md/lg/xl min-height SHRINKS at narrower breakpoints
// (counter-intuitive at a glance): object-fit:cover always scales the
// 1920×800 (2.4:1) image to fully cover the section box, and this image
// is wider than any realistic hero aspect ratio — so it always scales by
// HEIGHT, and the resulting width overflow is what gets cropped from the
// left (object-position:right). A TALLER section at the SAME width forces
// a bigger scale-up, which shows proportionally LESS of the image's width
// — including less of the pre-blurred left buffer — pushing the courier's
// onset further left into the text column. Confirmed by measurement, not
// guesswork: at 1024px width with a 700px-tall section (the first attempt
// here), the search bar and "30 min" stat visibly sat on top of the
// delivery bag (Playwright screenshot). Shortening the section at
// narrower breakpoints keeps the crop closer to the image's native
// aspect ratio, leaving enough of the blurred buffer visible for the text
// column to stay clear at every width — re-verified visually after this
// fix at every width in the QA list.

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

/**
 * Home page's full-width hero. Two structurally different presentations,
 * not just CSS tweaks on one layout — the courier photo and the text
 * column genuinely cannot share the same frame below md (see the mobile
 * block's own comment):
 *
 *  - md and up: classic full-bleed background-image hero. Image + gradient
 *    absolutely fill the <section>; text content sits in normal flow on
 *    top, capped to ~40% width so it never reaches the courier's zone.
 *  - below md: the courier gets his own top block (plain <img>, no text
 *    ever overlaid on it — nothing to contrast-check, nothing that can
 *    drift onto his face on a future copy change); the badge/heading/
 *    search/stats/payment content follows underneath in a solid dark
 *    panel that visually continues the image (matches Uber Eats/
 *    DoorDash-style mobile heroes, and the prompt's own mobile diagram).
 */
export function HeroSection({ q, onQChange, onSearch }: HeroSectionProps) {
  return (
    <section id="hero" className="relative overflow-hidden md:min-h-[560px] xl:min-h-[640px]">
      {/* Mobile/tablet-portrait image block — own stacking context, real
          height in normal flow (not absolute), so it never needs a
          min-height hack to avoid collapsing. Hidden at md+, where the
          full-bleed version below takes over instead of stacking both. */}
      <div className="relative h-[240px] w-full sm:h-[320px] md:hidden">
        <picture>
          <source srcSet={heroLivreurWebp} type="image/webp" />
          <img
            src={heroLivreurPng}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover object-right"
          />
        </picture>
        {/* Seam into the dark content panel right below — a gradient, not
            a hard cut, so the join reads as one deliberate composition. */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink to-transparent" />
      </div>

      {/* Desktop/tablet-landscape background image — hidden below md, so
          it's never loaded/laid out twice with the block above. */}
      <picture>
        <source srcSet={heroLivreurWebp} type="image/webp" />
        <img
          src={heroLivreurPng}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          className="absolute inset-0 hidden h-full w-full object-cover object-right md:block"
        />
      </picture>
      {/* Dark gradient — left side only, fading fully transparent well
          before the courier's zone so his side of the frame stays bright
          (prompt's own "LEFT = darker, RIGHT = image stays bright" rule). */}
      <div className="absolute inset-0 hidden bg-gradient-to-r from-black/85 via-black/55 to-transparent md:block" />

      {/* Content. Normal document flow + solid panel below md (mirrors
          the mobile diagram exactly); absolute-over-the-image at md+.
          Deliberately items-start + top padding, NOT flex+items-center:
          this block is pinned via inset-0 to the section's own (fairly
          tight, see the min-height comment above) box, and at 900px wide
          the badge/heading/subtitle/search/stats stack is taller than
          that box — center-aligning it clipped the badge chip clean off
          the top under overflow-hidden (Playwright screenshot). Top-
          anchoring means a too-tall stack just extends further down
          inside the box instead, which is always recoverable — never
          silently invisible. Never itself positioned with hand-placed
          coordinates otherwise — only max-width constrains it, so it can
          never drift onto the courier regardless of viewport width. */}
      <div className="relative z-10 bg-ink px-5 pt-7 pb-10 md:absolute md:inset-0 md:flex md:items-start md:bg-transparent md:px-0 md:pt-0 md:pb-0">
        <div className="mx-auto w-full max-w-[1200px] md:px-5 md:pt-8 lg:pt-14 xl:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-md md:max-w-[300px] lg:max-w-[400px] xl:max-w-[480px]"
          >
            {/* Badge */}
            <span className="mb-5 inline-block rounded-full bg-brand px-4 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-white shadow-[0_4px_16px_rgba(249,115,22,0.4)]">
              Livre lakay ou nan Gonaïves
            </span>

            {/* Heading */}
            {/* Explicit sizes per breakpoint, not a vw-based clamp() — the
                heading's actual available width is the narrow text COLUMN
                (300-480px at md-xl), not the raw viewport, and clamp(vw)
                doesn't know that: at md it sized the heading for a 900px
                viewport while the column was only 300px, wrapping "livre
                lakay ou" across 3-4 lines instead of one (Playwright
                screenshot). Sized per breakpoint against each column's
                real width instead. */}
            <h1 className="mb-5 font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-white md:text-3xl lg:text-5xl xl:text-6xl">
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
            <div className="mt-8 flex flex-wrap gap-6 md:gap-5 lg:gap-8">
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

          {/* Payment badge — anchored to the Hero's own content container
              (this div), never the viewport, so it can't drift off-frame
              at an unusual viewport size. Normal flow below md (matches
              the mobile diagram's own last row); pinned bottom-right of
              the hero at md+. */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-10 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.15)] backdrop-blur sm:gap-x-3 sm:px-5 sm:py-3 md:absolute md:right-5 md:bottom-8 md:mt-0 md:flex-nowrap"
          >
            {/* w-full forces this label onto its own line inside the
                flex-wrap row on mobile (so the badge reads as label line +
                icons line, not an unpredictable mid-row wrap) — reverts to
                auto width from `sm:` up, where there's room to sit inline. */}
            <span className="w-full text-xs font-semibold whitespace-nowrap text-ink sm:w-auto sm:text-sm">
              Peman disponib
            </span>
            <img
              src="/moncash-logo-hero.png"
              alt="MonCash"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded object-cover"
            />
            <div className="flex h-8 w-16 shrink-0 items-center justify-center gap-1 rounded border border-brand-soft/60 bg-white sm:w-24 sm:gap-1.5">
              <Banknote
                className="h-3.5 w-3.5 shrink-0 text-brand-deep sm:h-4 sm:w-4"
                aria-hidden="true"
              />
              <span className="text-[0.7rem] font-bold text-ink sm:text-xs">Kach</span>
            </div>
            <img
              src="/natcash-logo-new.png"
              alt="NatCash"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded object-cover"
            />
            {/* Kat Kredi (Stripe) — same treatment as the 3 methods above,
                added once payment-card-logo-integration confirmed it's a
                genuinely enabled provider (payment_provider_settings),
                not just visible-but-disabled. */}
            <img
              src="/katkredi.png"
              alt="Kat Kredi"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded object-cover"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
