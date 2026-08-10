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
          // webp/jpg/jpeg added: chef.jpg, hero-livreur.jpg, phone-mockup.jpg,
          // scooter.jpg, moncash-logo.webp, and public/dishes/*.webp were all
          // silently excluded before — first offline load of any page using
          // them showed a broken image. json added for any small static data
          // file the build emits (e.g. manifest-adjacent metadata); harmless
          // if none exist, matches zero files.
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
          //  - Mockup.png (753 kB, app-benefits-section.tsx): same
          //    `loading="lazy"` deferral, same reasoning — added when the
          //    section's phone mockup was swapped from phone-mockup.jpg
          //    (61 kB) to this taller replacement, an eager precache
          //    would silently undo that deferral for the largest single
          //    image on the home page.
          //  - scooter.png (1.4 MB, newsletter-section.tsx): same
          //    `loading="lazy"` deferral, same reasoning — replaced
          //    scooter.jpg (61 kB) as the newsletter card's image. At
          //    1.4 MB this is now the single largest asset on the home
          //    page; an eager precache would defeat the lazy deferral for
          //    every visitor, whether or not they scroll to the card.
          //  - scooter.jpg (61 kB): kept on disk (not deleted) but no
          //    longer referenced anywhere in src/ after the swap above —
          //    same "unused, don't pay for it upfront" reasoning as
          //    payment-global/** below.
          globIgnores: [
            "payment-global/**",
            "assets/vendor-pdf-*.js",
            "assets/vendor-charts-*.js",
            "kategori/*.webp",
            "Mockup.png",
            "scooter.png",
            "scooter.jpg",
          ],
        },
      }),
    ],
  },
});
