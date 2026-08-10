// Deliberately separate from vite.config.ts/vitest.config.ts — same
// precedent already established for the unit-test config in this repo.
// See docs/E2E_TEST_REPORT.md for what this suite covers and its known
// limitations (full network mock — see e2e/support/mock-supabase.ts).
import { defineConfig, devices } from "@playwright/test";

const APP_URL = "http://127.0.0.1:4173";
const MOCK_SUPABASE_URL = "http://127.0.0.1:54321";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: APP_URL,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    actionTimeout: 10_000,
  },
  webServer: [
    {
      command: "npx tsx e2e/mocks/ssr-bootstrap-server.ts",
      url: `${MOCK_SUPABASE_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      // Not `vite preview` — that command doesn't work with this
      // project's pinned `preset: "vercel"` Nitro output layout. See
      // e2e/mocks/preview-server.ts's own comment for why.
      command: "npx tsx e2e/mocks/preview-server.ts",
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // .env.e2e is only auto-loaded by Vite at *build* time (baking
      // import.meta.env.VITE_* into the bundle) — server-only code paths
      // (client.server.ts's service-role client, used by fire-and-forget
      // push-notification server functions) read plain process.env.* at
      // *runtime* instead, which this spawned Node process wouldn't
      // otherwise have. Harmless either way (those calls are best-effort
      // and never block a flow), but setting them quiets a misleading
      // "Missing Supabase environment variable" warning in test output.
      env: {
        SUPABASE_URL: MOCK_SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: "e2e-fake-publishable-key",
        SUPABASE_SERVICE_ROLE_KEY: "e2e-fake-service-role-key",
      },
    },
  ],
  projects: [
    { name: "client", testDir: "./e2e/client", use: { ...devices["Desktop Chrome"] } },
    { name: "auth", testDir: "./e2e/auth", use: { ...devices["Desktop Chrome"] } },
    { name: "restaurant", testDir: "./e2e/restaurant", use: { ...devices["Desktop Chrome"] } },
    { name: "driver", testDir: "./e2e/driver", use: { ...devices["Desktop Chrome"] } },
    { name: "admin", testDir: "./e2e/admin", use: { ...devices["Desktop Chrome"] } },
    {
      name: "cross-cutting",
      testDir: "./e2e/cross-cutting",
      use: { ...devices["Desktop Chrome"] },
    },
    // Responsive is its own project matrix re-running a small, deliberately
    // curated subset of layout-sensitive specs (e2e/responsive/) across
    // viewports — not the full flow inventory, which would ~4x total
    // runtime for marginal value. Promote a flow into e2e/responsive/ if
    // it's later found to be viewport-broken, rather than re-running
    // everything everywhere by default.
    {
      name: "responsive-mobile-chrome",
      testDir: "./e2e/responsive",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "responsive-mobile-safari",
      testDir: "./e2e/responsive",
      use: { ...devices["iPhone 13"] },
    },
    { name: "responsive-tablet", testDir: "./e2e/responsive", use: { ...devices["iPad Mini"] } },
    {
      name: "responsive-desktop",
      testDir: "./e2e/responsive",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
