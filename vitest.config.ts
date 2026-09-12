// Deliberately separate from vite.config.ts — that one is wrapped by
// @lovable.dev/vite-tanstack-config and pulls in the TanStack Start SSR
// plugin, Nitro, and PWA machinery, none of which a plain Node unit test
// needs (and TanStack Start's plugin actively rewrites/instruments route
// files, which would just get in the way here). Vitest only needs the
// same `@/*` path alias resolution the app itself uses.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // `.tsx` ak `.spec` ladan l EKSPRÈ. Anvan, `include` te di `*.test.ts`
    // sèlman: yon fichye `*.test.tsx` oswa `*.spec.ts` nan `src/` pa t ap
    // janm kouri, EPI swit la t ap rete vèt. Yon tès ki inyore an silans pi
    // mal pase pa gen tès ditou — li bay konfyans san li pa bay kouvèti.
    //
    // Tès Playwright yo pa konsène: yo nan `e2e/`, deyò `src/`.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
