// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Hard-pin the deploy target: this project is linked to Vercel (see
  // .vercel/project.json and the security headers in vercel.json), but
  // without an explicit preset here, Nitro's zero-config `defaultPreset`
  // falls back to `cloudflare-module` for any build that isn't literally
  // running inside Vercel's own build environment (i.e. every local build
  // and any CI runner that isn't Vercel itself) — producing a
  // wrangler.json/Cloudflare Worker instead of a Vercel-compatible
  // function, so "does the production build work" couldn't be verified
  // outside of Vercel's own infra. Pinning it here makes every build
  // (local, CI, Vercel) produce the exact same Vercel Build Output API
  // artifact. Ignored inside Lovable's own editor/preview pipeline, which
  // always forces Cloudflare regardless — see the `nitro` option's doc
  // comment in @lovable.dev/vite-tanstack-config's type declarations.
  nitro: {
    preset: "vercel",
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Keep slow-changing vendor code in its own long-term-cacheable
          // chunks, separate from app code that changes on every deploy —
          // a redeploy that only touches routes/components shouldn't force
          // every returning visitor to re-download React/the router/map/
          // charting libraries they already have cached. Names are
          // intentionally coarse (a handful of stable chunks, not one per
          // package) to avoid the opposite problem of hundreds of tiny
          // chunks adding request overhead.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]leaflet[\\/]|[\\/]react-leaflet[\\/]/.test(id)) return "vendor-leaflet";
            if (/[\\/]recharts[\\/]|[\\/]victory-vendor[\\/]|[\\/]d3-[a-z-]+[\\/]/.test(id))
              return "vendor-charts";
            if (
              /[\\/]jspdf[\\/]|[\\/]html2canvas[\\/]|[\\/]canvg[\\/]|[\\/]dompurify[\\/]/.test(id)
            )
              return "vendor-pdf";
            if (/[\\/]framer-motion[\\/]/.test(id)) return "vendor-motion";
            // Refonte Frontend Premium, Phase 8 (P8) — anchored to
            // node_modules/<pkg>/ specifically. The previous bare
            // [\/]react[\/] segment match also matched any path merely
            // *containing* a "react" directory anywhere in it — which
            // includes node_modules/@sentry/react/... (the package's own
            // subfolder is literally named "react"). That silently pulled
            // the whole @sentry/react SDK into this chunk too, which is
            // eager on every page (React itself has to be), defeating the
            // P8 fix that made sentry-browser.ts a dynamic import
            // specifically so it *wouldn't* be in the initial load.
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
              return "vendor-react";
            if (/[\\/]@tanstack[\\/]/.test(id)) return "vendor-tanstack";
            if (/[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
            return undefined;
          },
        },
      },
    },
    plugins: [
      VitePWA({
        // `registerType` only affects the registration script the plugin
        // itself generates — moot with `injectRegister: null`, since SW
        // registration and the "new version available" reload prompt are
        // both hand-rolled in src/lib/pwa-register.ts instead.
        injectRegister: null,
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: false,
        // Vite's own build.outDir ("dist") is just an intermediate
        // per-environment path in this multi-environment TanStack Start
        // setup and is never actually served — the real static output
        // location depends on the active Nitro preset (see the `nitro`
        // option above). With `preset: "vercel"` pinned, Nitro assembles
        // the client bundle straight into .vercel/output/static (Vercel's
        // Build Output API layout), not .output/public. Without this
        // override, vite-plugin-pwa wrote sw.js into dist/ (never deployed,
        // unreachable at /sw.js) and precached 0 files (it globbed the
        // wrong, empty directory) — if the preset above ever changes, this
        // path needs updating to match.
        outDir: ".vercel/output/static",
        injectManifest: {
          globDirectory: ".vercel/output/static",
          // webp/jpg/jpeg added: chef.jpg, phone-mockup.jpg, scooter.jpg,
          // moncash-logo.webp, and public/dishes/*.webp were all silently
          // excluded before — first offline load of any page using them
          // showed a broken image. json added for any small static data
          // file the build emits (e.g. manifest-adjacent metadata); harmless
          // if none exist, matches zero files. hero-livreur.webp/.png (hero
          // section, LCP/fetchPriority="high") covered by the same webp/png
          // entries, no glob change needed for that swap.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg,json,webmanifest,woff2}"],
          // Refonte Frontend Premium, Phase 8 (P8) — the glob above matched
          // every route's chunk indiscriminately: 256 entries / ~5.65 MiB
          // precached eagerly right after first visit, for every visitor,
          // regardless of which role/pages they'll ever touch. Two classes
          // excluded here, both still fully reachable at their own URL —
          // this only stops the service worker's *eager* background
          // precache of them, not their availability:
          //  - public/payment-global/** (1.5 MB / 36 files): grepped
          //    every reference in src/, none found — dead weight, likely
          //    social/OG assets for an external service, never fetched by
          //    the app itself.
          //  - vendor-pdf / vendor-charts (779.7 kB + 358.9 kB): already
          //    behind a dynamic `import()` (jspdf) or a route-only static
          //    import (recharts in dashboard revenue views) — never in a
          //    customer's initial load path. The runtime `CacheFirst` rule
          //    in src/sw.ts still caches them the first time an admin/
          //    restaurant user actually loads one, same offline guarantee,
          //    just not paid upfront by every visitor.
          //  - public/kategori/*.webp (Kategori Pla home-page rail, ~3.4
          //    MB / 10 files, added post-P10): 6 of the 10 cards already
          //    use `loading="lazy"` in kategori-pla-section.tsx precisely
          //    so their fetch is deferred until scrolled near — an eager
          //    SW precache would silently undo that deferral for every
          //    visitor regardless of whether they ever scroll the rail.
          //    Same CacheFirst runtime rule picks each one up the moment
          //    it's actually requested, still fully cached for offline
          //    after that.
          //  - app-mockup-v4.webp + .png (51 kB + 336 kB,
          //    app-benefits-section.tsx; te app-mockup-v3.png, 365 kB, yon
          //    sèl <img> jiska 2026-09-15): same
          //    `loading="lazy"` deferral, same reasoning — an eager
          //    precache would silently undo that deferral for a
          //    prominent home-page image. Renamed from app-mockup-v2.png
          //    (2026-08-28, itself renamed from Mockup.png on 2026-08-27):
          //    reusing either filename for new content hits the exact
          //    staleness bug hero-livreur.png's own comment describes
          //    below — being excluded from the revisioned precache
          //    manifest here means this file is ONLY ever cached via
          //    src/sw.ts's runtime CacheFirst "static-assets" rule, which
          //    has no content-revision awareness and would serve stale
          //    image bytes to returning visitors for up to 30 days after
          //    the next content swap. A new filename is a guaranteed cache
          //    MISS regardless of any client's existing SW cache state.
          //    -v2 (app-mockup-v2.png) was kept on disk unreferenced for a
          //    while, then deleted (odit tout baz la, Faz 3/7, 2026-08-31)
          //    — no longer needs a globIgnores entry of its own (a glob
          //    can't match a file that doesn't exist).
          //  - scooter-v2.jpg (78 kB, newsletter-section.tsx; te
          //    scooter.png, 1.4 MB, jiska 2026-09-15): same
          //    `loading="lazy"` deferral, same reasoning — an eager
          //    precache would defeat the lazy deferral for every visitor,
          //    whether or not they scroll to the card. At 1.4 MB it had
          //    been the single largest asset on the home page, and the
          //    single worst line in the A6 audit: `loading="lazy"` DEFERS a
          //    fetch, it never cancels it, so every visitor who scrolled
          //    paid it in full for a ~460 px box.
          //  - scooter.jpg (61 kB, unreferenced since the scooter.png swap
          //    above) and bg-hero.png (1.9 MB, unreferenced since the
          //    bg-hero-v2.png/.webp swap, BRIEF — HERO MOBIL PWA,
          //    2026-08-28) were both deleted (odit tout baz la, Faz 3/7,
          //    2026-08-31) rather than left unreferenced on disk — neither
          //    needs a globIgnores entry any more. NOTE BYEN: se poutèt sa
          //    nouvo fichye a rele scooter-V2.jpg epi non scooter.jpg. Yon
          //    navigatè ki te kache ansyen scooter.jpg la (yon LÒT foto)
          //    anvan 2026-08-31 rete anndan fenèt 30 jou CacheFirst la, epi
          //    li t ap kontinye sèvi ansyen foto a sou menm URL la.
          //  - bg-hero-v2.jpg (127 kB, <picture> fallback for the file
          //    above; te bg-hero-v2.png, 2.44 MB, canvas-re-encoded, jiska
          //    2026-09-15): the original reason for excluding it was that
          //    it exceeded Workbox's 2 MiB injectManifest limit and failed
          //    the build outright ("Configure
          //    injectManifest.maximumFileSizeToCacheInBytes..."). At 127 kB
          //    that reason is gone, but the entry stays for the reason that
          //    always mattered more: precaching a fallback makes every
          //    visitor pay for a file >97% of them never request (WebP
          //    support is >97% globally) — it's only ever cached via
          //    src/sw.ts's runtime CacheFirst rule instead, same tradeoff
          //    as every other excluded entry in this list.
          //    bg-hero-v2.webp (85 kB since 2026-09-15, was 144.6 kB — the
          //    canvas encoder it came from was simply spending more bytes
          //    than sharp needs; what actually loads for nearly
          //    every visitor) is DELIBERATELY left OUT of this list, same
          //    as hero-livreur-v2 below: fetchPriority="high", not
          //    lazy-loaded, so an eager precache is exactly what's wanted
          //    for a repeat visitor, not something to defer, and it's
          //    nowhere near the size limit.
          //  - hero-livreur.png was excluded here for one session (grew
          //    past Workbox's 2 MiB injectManifest limit at an intermediate
          //    canvas-extended size and briefly failed the build outright).
          //    The final courier-right composition (now hero-livreur-v2.jpg,
          //    89 kB since 2026-09-15, was a 1.25 MB PNG) is back under the
          //    limit. Sa ki vin apre a: pandan yon moman li te retire nan
          //    lis la espre, pou yon rezon ki toujou vo pou konnen —
          //    excluding it here means it's only
          //    ever cached via src/sw.ts's plain CacheFirst "static-assets"
          //    rule, which has NO content-revision awareness and served
          //    stale image bytes to returning visitors for up to 30 days
          //    across three same-filename content swaps this session (the
          //    root cause behind "image disparèt sou mobil" — see
          //    hero-section.tsx's own comment). precacheAndRoute (this glob)
          //    correctly detects a content-hash change and busts the old
          //    entry on every future deploy, which CacheFirst alone never
          //    does.
          //
          //    MEN LI NAN LIS LA KOUNYE A ANKÒ, epi se yon chwa: paragraf sa
          //    a te kontredi antre `hero-livreur-v2` ki anba a depi yon bon
          //    bout tan (2026-09-15: youn te di «retire nan lis la», lòt la
          //    te la nan lis la). Desizyon an: li RETE eskli. Pwoteksyon
          //    kont vye octè a pa soti nan prekach la, li soti nan
          //    konvansyon chanje non an — chak swap kontni isit la pran yon
          //    non tou nèf, ki se yon MISS garanti pou tout kliyan, kit yo
          //    prekache kit yo pa prekache. Epi prekache yon repli fè 97%
          //    moun peye pou yon fichye yo p ap janm mande. Se sèl rezon ki
          //    dwe deside, epi li deside menm jan pou tout repli yo.
          globIgnores: [
            "payment-global/**",
            // Fichye rasin lan `payment-global-logo.svg` PA matche
            // "payment-global/**" — pa gen bar apre non an, donk glob la pa
            // kouvri l. Li t ap glise nan prekach la pandan tout DOSYE a te
            // byen eskli. Mezire nan sw.js pwodiksyon an: li te la.
            "payment-global-logo.svg",
            // hero-livreur-v2.jpg se REPLI a nan yon <picture> ki gen yon
            // jimo WebP (hero-livreur-v2.webp, 50 Ko) — hero-section.tsx.
            // Li BYEN referanse, donk li rete nan build la epi li disponib
            // sou rezo pou yon navigatè ki pa sipòte WebP.
            //
            // Li te yon PNG 1 224 Ko — mwatye tout prekach `public/` la. Li
            // se yon JPEG 89 Ko kounye a (2026-09-15,
            // scripts/optimize-static-images.mjs), donk agiman «li twò gwo»
            // la pa kenbe ankò. Men li rete eskli pou yon lòt rezon ki pi
            // solid: prekache yon repli vle di chak vizitè peye pou yon
            // fichye plis pase 97% nan yo pa janm mande. Se sèlman
            // prekachman an ki sispann, pa disponiblite a.
            "hero-livreur-v2.jpg",
            // Ansyen logo NatCash la: tout senk kote ki afiche yon logo
            // NatCash pwente sou `/natcash-logo-new.png`. Fichye a efase nan
            // menm remedyasyon an; antre a retire isit la tou pou glob la pa
            // ret ap chèche l.
            "natcash-logo.png",
            "assets/vendor-pdf-*.js",
            "assets/vendor-charts-*.js",
            "kategori/*.webp",
            // KAT ANTRE ANBA YO CHANJE NON 2026-09-15
            // (scripts/optimize-static-images.mjs). Rezon ki fè yo eskli a
            // pa chanje — se pwa a ak sous la ki chanje:
            //
            //   scooter.png      1 391 Ko -> scooter-v2.jpg        78 Ko
            //   bg-hero-v2.png   2 387 Ko -> bg-hero-v2.jpg       127 Ko
            //   app-mockup-v3.png  365 Ko -> app-mockup-v4.webp    51 Ko
            //                                app-mockup-v4.png    336 Ko
            //
            // Non yo chanje EKSPRE, epi se presizeman paske yo nan lis sa a:
            // yon fichye ki eskli isit la pa nan manifès revizyone a, donk
            // sèl bagay ki kache l se reg CacheFirst "static-assets" nan
            // src/sw.ts:26-27 — 30 jou, zewo konsyans revizyon. Se sa
            // kòmantè hero-livreur.png anwo a dokimante. Yon non tou nèf se
            // yon MISS garanti.
            //
            // (bg-hero-v2.webp ak hero-livreur-v2.webp rete DEYÒ lis sa a
            // espre — yo prekache, donk manifès la wè chanjman kontni yo epi
            // li kase ansyen antre a pou kont li. Se poutèt sa bg-hero-v2.webp
            // te ka reankode 145 -> 85 Ko san chanje non.)
            "scooter-v2.jpg",
            "bg-hero-v2.jpg",
            // Toude mòso <picture> app-mockup la: li `loading="lazy"`, epi
            // yon prekach anpresman ta anile defèman sa a pou chak vizitè,
            // kit yo desann rive sou li kit yo pa desann.
            "app-mockup-v4.webp",
            "app-mockup-v4.png",
          ],
        },
      }),
    ],
  },
});
