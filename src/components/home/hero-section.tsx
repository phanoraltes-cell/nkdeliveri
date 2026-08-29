import { motion } from "framer-motion";
import { Search, Clock, MapPin, Store, UtensilsCrossed, ShieldCheck, Banknote } from "lucide-react";
import { HERO_MOBILE_ZONES, zoneCenterPercent } from "./hero-mobile-zones";

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
// -v2 filenames deliberately, not a reused hero-livreur.png/.webp: this
// exact content has already been overwritten in place under the OLD
// filename three times earlier this session (square photo → canvas-
// extended → this courier-right composition). vite-plugin-pwa's
// precacheAndRoute correctly revisions changed content by hash, but the
// .png specifically was excluded from precache (globIgnores in
// vite.config.ts, from when the pre-swap file was 3.68 MB) and only ever
// reached through src/sw.ts's plain CacheFirst "static-assets" rule —
// which has NO revision awareness at all and serves whatever it cached
// under that exact URL for up to 30 days, network or no network. Any
// returning visitor/tester whose browser had an old copy cached there
// would see stale (possibly broken/partial) image bytes indefinitely,
// while every other Hero element (plain SSR'd text, no separate fetch)
// kept rendering fine — the leading hypothesis for "image disparèt sou
// mobil, rès la ok" reported after 3 same-filename swaps in one session.
// A new filename is a guaranteed cache MISS for every client regardless
// of SW/cache state, independent of whether this was actually the cause.
const heroLivreurWebp = "/hero-livreur-v2.webp";
const heroLivreurPng = "/hero-livreur-v2.png";

// Mobile-only replacement (owner-provided, 2026-08-26; re-cropped and
// overlay-enabled 2026-08-28 per BRIEF — HERO MOBIL PWA). Desktop keeps
// the 1920×800 landscape asset above untouched — this is a separate
// 1024×1536 PORTRAIT (2:3) source photo, and object-fit:cover behaves
// oppositely on it: a portrait source in a landscape-ish container scales
// by WIDTH, not height, so nothing is ever cropped horizontally (the
// full frame width always shows) and object-position only needs to
// steer the VERTICAL crop. See the mobile block's own comment for how
// its container height was derived from this image's actual content
// coordinates.
//
// -v2 filenames, cropped 1024×1365 (top-anchored, same source): the
// original 1024×1536 PNG was 1.9 MB with no .webp sibling — 38× the
// desktop hero's own 50 KB .webp, a real cost on the weak connections
// this hero is designed around. Generated in the same operation as the
// zone re-crop (not a separate pass) via a headless-Chromium canvas
// (no sharp/ImageMagick/cwebp available in this environment): .webp at
// quality 0.9 lands at 144.6 KB (target was <150 KB — every higher
// quality tried, 0.92 and up, exceeded it); .png fallback for
// <picture> is 2.39 MB (canvas's built-in PNG encoder compresses worse
// than whatever produced the original — acceptable since it's a
// same-origin fallback essentially no real visitor's browser ever
// fetches, WebP support is >97% globally). Old bg-hero.png kept on
// disk (not deleted, same precedent as hero-livreur.jpg/
// app-mockup-v2.png) but excluded from the SW precache manifest below
// now that nothing references it.
const heroMobileWebp = "/bg-hero-v2.webp";
const heroMobilePng = "/bg-hero-v2.png";

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
  { n: "20+", l: "Restoran", Icon: Store },
  { n: "100+", l: "Plat disponib", Icon: UtensilsCrossed },
  { n: "40 min", l: "Livrezon mwayèn", Icon: Clock },
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
 *  - below md: the courier gets his own top block, now carrying nearly
 *    all of the hero's content directly on top of it — badge on the cap,
 *    search bar on the chest, heading+subtitle over the hands/bag area,
 *    face zone left completely clear (BRIEF — HERO MOBIL PWA,
 *    2026-08-28, and a follow-up request the same day; see
 *    hero-mobile-zones.ts for the enforced, tested zone contract). This
 *    REVERSES an earlier decision (until 2026-08-27) to never overlay
 *    text on this photo at all, made specifically to avoid the class of
 *    bug a naive fixed object-position overlay causes across varying
 *    phone heights — the brief's own "art direction, not pixel-pinning"
 *    method (percentage zones anchored to the photo's own aspect-ratio
 *    box, not the viewport) is what makes reintroducing an overlay safe
 *    this time.
 *    Went through two more iterations the same day, each on direct
 *    feedback: first the photo-to-panel fade gradient was removed
 *    ("koule degrade... retire net... fè li senp"), then the flat
 *    --ink-warm panel itself was removed entirely and heading+subtitle
 *    moved onto the photo too ("fè teks la parèt sou imaj livre a...
 *    retire bg marron an"). Only trust stats and the payment badge still
 *    render below the photo now, on the page's own plain bg-cream (no
 *    background of their own) — matching Uber Eats/DoorDash-style
 *    mobile heroes where the photo carries nearly everything and only
 *    secondary content trails below it. No gradient/scrim of any kind
 *    remains on the mobile photo; the two on-photo text blocks
 *    (heading/subtitle) rely on text-shadow, not a background, for
 *    legibility — see that block's own comment for why that's different
 *    from the solid-pill treatment the badge/search-button use.
 */
export function HeroSection({ q, onQChange, onSearch }: HeroSectionProps) {
  return (
    <section id="hero" className="relative overflow-hidden md:min-h-[560px] xl:min-h-[640px]">
      {/* Mobile/tablet-portrait hero visual — the plain photo, no fade
          overlay of any kind (removed 2026-08-28 on request: "senp,
          sèlman imaj livrè a") and no panel handoff below it either (the
          flat --ink-warm panel this used to fade into was itself removed
          the same day — see this file's own top comment). Badge, search
          bar, and now heading+subtitle all render directly on top of
          this image (further down); only trust stats and the payment
          badge still live below it, on the page's own plain background.
          Own stacking context, real height in normal flow (not
          absolute), so it never needs a min-height hack to avoid
          collapsing. Hidden at md+, where the full-bleed desktop version
          below takes over instead of stacking both.

          aspect-[1024/1365] (not a fixed h-[…px] like the desktop asset
          used) is deliberate:
          bg-hero-v2.png is a 1024×1536 PORTRAIT photo whose subject — cap
          logo (~y190-260), face (~y350-560), chest "NK DELIVERI" (~y780-
          880), backpack logo (~y880-1060), and paper-bag logo (~y1030-
          1220) — occupies almost its entire height, unlike the old
          landscape asset which had a compact, croppable subject. A fixed
          px height (the right call for the old image) would show a
          different FRACTION of this one at 375px vs 430px width; an aspect-ratio
          container shows the identical 0-1365 slice of the source at every
          width — extended from the original 1250 (BRIEF — HERO MOBIL PWA,
          2026-08-28) to land on a ~3:4 ratio, comfortably inside the
          1536px source (no upscaling) and with room to spare for the
          badge/search-bar overlays below. Verified against those
          coordinates (Playwright ruler overlay) to include cap, face, and
          both branded bags with zero horizontal crop (cover scales this
          portrait source by width in a wider-than-image container, so
          nothing is ever cut left/right — only object-position's vertical
          axis matters here). */}
      <div className="relative aspect-[1024/1365] w-full overflow-hidden md:hidden">
        <picture>
          <source srcSet={heroMobileWebp} type="image/webp" />
          <img
            src={heroMobilePng}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </picture>
        {/* Badge — BRIEF — HERO MOBIL PWA (2026-08-28): anchored to
            zone-kepi (HERO_MOBILE_ZONES.kepi), not a hand-picked offset.
            -translate-y-1/2 centers it within the zone band regardless of
            the pill's own rendered height. Shortened copy ("Livre nan
            Gonaïves" vs. the shared/desktop badge's full "Livre lakay ou
            nan Gonaïves") — "lakay ou" dropped as redundant with the H1
            immediately below in the panel ("Manje lakay, livre lakay
            ou"), not a meaning change.
            bg-ink-warm, NOT bg-brand (the shared/desktop badge's own
            color, unchanged there): measured (not estimated) contrast —
            white text on bg-brand is 2.80:1, failing WCAG AA even for
            large text (needs 3:1) well before normal text's 4.5:1. This
            was already true of the existing desktop badge/search-button,
            out of scope to fix here ("pa touche desktop"), but a NEW
            element can't ship failing what this brief itself makes
            non-negotiable. --ink-warm (already used by the flat panel
            this photo hands off into, further down) measures 17.87:1
            with white — reusing an existing token, not inventing a
            second color system. Also solves the "orange pill can blend
            into the orange cap" problem an earlier draft used a
            separate radial-gradient vignette for — a dark pill doesn't
            need one. */}
        {/* Centered (2026-08-28, user request) — was left-aligned at
            left-[max(1.25rem,var(--sal))]. left-1/2 + translate(-50%,
            -50%) centers it both ways from a single point; the two
            translate axes have to live in the same transform, since a
            second `-translate-x-1/2` Tailwind class would set its own
            `transform` and silently overwrite the inline
            translateY(-50%) used to center in the zone band, not stack
            with it. */}
        <div
          className="absolute z-10 left-1/2"
          style={{
            top: `${zoneCenterPercent(HERO_MOBILE_ZONES.kepi)}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink-warm px-4 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-white shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            Livre nan Gonaïves
          </span>
        </div>

        {/* Search bar — anchored to zone-pwatrin. A fully opaque white
            pill needs no scrim of its own (nothing behind it can show
            through), unlike the badge above. Duplicates the shared form
            further down (same q/onQChange/onSearch props, same visual
            treatment) rather than repositioning one shared instance —
            matches this file's own existing pattern for mobile-only vs.
            desktop-only blocks (trust-compact vs. full-icon-treatment
            below); only one copy is ever visible at a time
            (`md:hidden`/`hidden md:flex`), so there's no duplicate
            submission risk, and a hidden <form> is correctly excluded
            from the accessibility tree by every browser. */}
        <div
          className="absolute z-10 left-[max(1.25rem,var(--sal))] right-[max(1.25rem,var(--sar))]"
          style={{
            top: `${zoneCenterPercent(HERO_MOBILE_ZONES.pwatrin)}%`,
            transform: "translateY(-50%)",
          }}
        >
          <form
            onSubmit={onSearch}
            className="flex items-center rounded-full bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.25)] ring-1 ring-white/20"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-soft">
              <MapPin className="h-5 w-5" />
            </span>
            <input
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              placeholder="Chèche yon restoran oswa yon plat…"
              aria-label="Chèche yon restoran oswa yon plat…"
              className="min-w-0 flex-1 rounded-full bg-transparent px-2 py-3 text-sm outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            {/* bg-ink-warm, not bg-brand (the shared/desktop button's own
                color, unchanged there) — same 2.80:1-fails-AA measured
                reason as the badge above; 17.87:1 with white. */}
            <button
              type="submit"
              className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink-warm px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <Search className="h-4 w-4" /> Chèche
            </button>
          </form>
        </div>

        {/* Heading + subtitle + trust stats — moved onto the photo
            (2026-08-28, user requests: "fè tèks la parèt sou imaj livre
            a", then "santre" the text and move the stats line onto the
            image too "pou li ka vizib sou imaj la tou"). The flat panel
            these used to live in is gone entirely — no more bg-ink-warm
            below md. Centered (text-center + a centered flex column for
            the stats row), replacing the original left-aligned block.
            Anchored to zone-tit's TOP (not centered like kepi/pwatrin
            above): this block's height depends on how many lines the
            heading/subtitle wrap to plus the stats row, so it flows down
            from a fixed start instead of trying to center a
            variable-height block in a fixed band. Text-shadow, not a
            background pill or a scrim, carries legibility over the busy
            hands/bag area below it — the brief's own "no uniform scrim"
            rule, extended here to mean no LOCAL scrim either, per the
            same request. Heading/subtitle copy matches the shared/desktop
            instance further down — that one is hidden below md instead
            of duplicating text with a subtly different edit two places
            to keep in sync; the stats row duplicates HERO_STATS' first
            three entries by hand (compact single-line format, not the
            icon-grid desktop uses — same divergence the original
            trust-compact block already had before this move).
            mb-1/mt-1.5 (not mb-2/mt-3) on the heading/stats-row below:
            measured margin between this block's bottom and the photo's
            own bottom edge at only 3.8px on iPhone SE (375×667, the
            shortest supported height) before this tightening — enough
            to fit today, but no real safety margin against any font-
            metric variance. Tightened to 13.8px/19px/26.7px measured
            margin across all 3 required breakpoints (SE/iPhone 14/
            Pixel 8) instead. */}
        <div
          className="absolute z-10 left-[max(1.25rem,var(--sal))] right-[max(1.25rem,var(--sar))] text-center"
          style={{ top: `${HERO_MOBILE_ZONES.tit.top}%` }}
        >
          {/* Both heading lines white, not text-brand for the second one
              like the shared/desktop heading uses: this exact spot sits
              on top of the kraft bag's own printed "NK DELIVERI" logo,
              which is the SAME orange — text-brand here collided
              directly with it (Playwright screenshot, 2026-08-28),
              reading as visual noise instead of two separate things.
              White stays legible against both the tan bag and the
              orange shirt around it. */}
          <h1
            className="mb-1 font-display text-2xl font-extrabold leading-[1.05] tracking-tight text-white"
            style={{ textShadow: "0 2px 10px rgba(0,0,0,0.55)" }}
          >
            Manje lakay,
            <br />
            livre lakay ou
          </h1>
          <p
            className="mx-auto max-w-[32ch] text-[13px] leading-snug text-white/90"
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}
          >
            Manje kreyòl otantik, livre cho lakay ou nan mwens pase 45 minit.
          </p>
          <div
            className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-bold text-white"
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}
          >
            <span>20+ Restoran</span>
            <span aria-hidden="true" className="text-white/50">
              ·
            </span>
            <span>100+ Plat</span>
            <span aria-hidden="true" className="text-white/50">
              ·
            </span>
            <span>~40 min</span>
          </div>
        </div>
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

      {/* Content. Normal document flow below md; absolute-over-the-image at
          md+. Deliberately items-start + top padding, NOT flex+items-
          center: this block is pinned via inset-0 to the section's own
          (fairly tight, see the min-height comment above) box, and at
          900px wide the badge/heading/subtitle/search/stats stack is
          taller than that box — center-aligning it clipped the badge
          chip clean off the top under overflow-hidden (Playwright
          screenshot). Top-anchoring means a too-tall stack just extends
          further down inside the box instead, which is always
          recoverable — never silently invisible. Never itself positioned
          with hand-placed coordinates otherwise — only max-width
          constrains it, so it can never drift onto the courier regardless
          of viewport width. */}
      {/* No background below md (2026-08-28, user request: "retire bg
          marron an" — the flat --ink-warm panel this used to be is
          gone). Badge, heading, subtitle, and the search form all moved
          onto the photo itself (above); only the trust stats and payment
          badge still render here on mobile now, sitting directly on the
          page's own bg-cream (from the outer wrapper in routes/index.tsx)
          — their own text colors were dark-ink from the start (payment
          badge) or switched from white to dark-ink here (trust stats,
          see that block's own comment) to stay legible against a light
          background instead of a dark one. */}
      <div className="relative z-10 overflow-hidden px-5 pt-5 pb-8 md:absolute md:inset-0 md:flex md:items-start md:overflow-visible md:px-0 md:pt-0 md:pb-0">
        <div className="relative mx-auto w-full max-w-[1200px] md:px-5 md:pt-8 lg:pt-14 xl:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-md md:max-w-[300px] lg:max-w-[400px] xl:max-w-[480px]"
          >
            {/* Badge — location pin icon added (visual reinforcement, same
                text/business logic, just a "📍" equivalent per the ask).
                hidden below md (BRIEF — HERO MOBIL PWA, 2026-08-28): this
                exact badge now lives anchored on the mobile photo instead
                (zone-kepi, above) with shortened copy — desktop keeps this
                full-text version, in its original position, untouched. */}
            <span className="mb-4 hidden items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-white shadow-[0_4px_16px_rgba(249,115,22,0.4)] md:inline-flex">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              Livre lakay ou nan Gonaïves
            </span>

            {/* Heading — hidden below md (2026-08-28): this exact copy now
                lives anchored on the mobile photo instead (zone-tit,
                above). Explicit sizes per breakpoint, not a vw-based
                clamp() — the heading's actual available width is the
                narrow text COLUMN (300-480px at md-xl), not the raw
                viewport, and clamp(vw) doesn't know that: at md it sized
                the heading for a 900px viewport while the column was
                only 300px, wrapping "livre lakay ou" across 3-4 lines
                instead of one (Playwright screenshot). Sized per
                breakpoint against each column's real width instead. */}
            <h1 className="mb-5 hidden font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-white md:block lg:text-5xl xl:text-6xl">
              Manje lakay,
              
              <span className="text-brand">livre lakay ou</span>
            </h1>

            {/* Subtitle — hidden below md, same reason as the heading
                above. Shortened from a 3-line sentence to fit 1-2 lines
                on a small phone (was pushing the search CTA well below the
                first viewport at 320-390px). "Gonaïves" dropped here
                deliberately, not lost — the badge right above already
                states it, repeating it a second time in the very next line
                added length without adding information. */}
            <p className="mb-7 hidden max-w-[38ch] text-[15px] leading-relaxed text-white/80 md:block">
              Manje kreyòl otantik, livre cho lakay ou nan mwens pase 45 minit.
            </p>

            {/* Search bar — hidden below md (BRIEF — HERO MOBIL PWA,
                2026-08-28): this exact form now lives anchored on the
                mobile photo instead (zone-pwatrin, above), same
                q/onQChange/onSearch. Desktop keeps this instance,
                untouched. */}
            <form
              onSubmit={onSearch}
              className="hidden max-w-[520px] items-center rounded-full bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.25)] ring-1 ring-white/20 md:flex"
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
                className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(249,115,22,0.4)] transition hover:bg-brand-deep hover:shadow-[0_12px_28px_rgba(249,115,22,0.5)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
              >
                <Search className="h-4 w-4" /> Chèche
              </button>
            </form>

            {/* The mobile-only security line that used to render here
                (below the photo, next to the numeric stats row before
                that moved onto the photo) was removed entirely
                2026-08-28 on request ("efase seksyon peman sekirize...
                Peman an sekirite"). Desktop's own security indicator
                lives independently in the full-icon-treatment grid
                below (HERO_STATS' "Sekirite" entry) — untouched. */}

            {/* Full icon treatment — md+ only, where there's no vertical
                constraint forcing the compact version above. */}
            <div className="mt-8 hidden flex-wrap gap-5 md:flex lg:gap-8">
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
              at an unusual viewport size. Hidden entirely below md
              (2026-08-28, user request: "efase seksyon peman
              sekirize... Peman disponib") — pinned bottom-right of the
              hero at md+, unchanged there. Its frame (bg-white/95,
              rounded-2xl, shadow, backdrop-blur, padding) was already
              md:-only from the previous commit (mobile used to render
              this unframed before today's request removed it from
              mobile altogether); left as md:-prefixed since only
              desktop reaches these classes now anyway. */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="hidden md:absolute md:right-5 md:bottom-8 md:inline-flex md:max-w-full md:flex-nowrap md:items-center md:gap-x-3 md:gap-y-2 md:rounded-2xl md:bg-white/95 md:px-5 md:py-3 md:shadow-[0_12px_28px_rgba(0,0,0,0.15)] md:backdrop-blur"
          >
            {/* Was w-full sm:w-auto (forced this label onto its own line
                above the icons in the mobile flex-wrap row) — simplified
                to one fixed width now that the whole badge is hidden
                below md: at the only breakpoint this ever renders,
                flex-nowrap never wraps in the first place. */}
            <span className="text-sm font-semibold whitespace-nowrap text-ink">Peman disponib</span>
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
