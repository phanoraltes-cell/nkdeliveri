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
        // Nitro's client build is assembled into .output/public regardless of
        // deploy target (Cloudflare, Vercel, etc.) — Vite's own build.outDir
        // ("dist") is just an intermediate per-environment path in this
        // multi-environment TanStack Start setup and is never actually
        // served. Without this override, vite-plugin-pwa wrote sw.js into
        // dist/ (never deployed, unreachable at /sw.js) and precached 0
        // files (it globbed the wrong, empty directory).
        outDir: ".output/public",
        injectManifest: {
          globDirectory: ".output/public",
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        },
      }),
    ],
  },
});
