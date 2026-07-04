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
