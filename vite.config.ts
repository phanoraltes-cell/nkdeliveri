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
            if (/[\\/]react[\\/]|[\\/]react-dom[\\/]|[\\/]scheduler[\\/]/.test(id))
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
        registerType: "autoUpdate",
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
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        },
      }),
    ],
  },
});
