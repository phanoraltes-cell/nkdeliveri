import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * De bagay isit la ka regrese an silans, epi okenn nan de a pa ta fè yon
 * tès echwe si nou pa te ekri sa yo:
 *
 *   * `pathname` SÈLMAN. Si yon jou yon moun mete `window.location.href`
 *     olye a, jeton nan lyen reyinisyalizasyon modpas yo ak `?next=` yo ap
 *     kòmanse rive nan Sentry — pandan konfigirasyon an ap toujou di
 *     `sendDefaultPii: false`.
 *   * Koupe tag la. Sentry koupe sa ki depase 200 karaktè POU OU, an
 *     silans. Si nou pa koupe nou menm, nou pa konnen sa ki rive vre.
 */

const captureException = vi.fn();
const init = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => init(...args),
  captureException: (...args: unknown[]) => captureException(...args),
  withScope: (fn: (scope: { setTag(k: string, v: string): void }) => void) => {
    // Yon `Scope` fo, ase pou kòd la kouri tou bon — pa gen jsdom nan
    // pwojè a, epi nou pa bezwen youn pou sa.
    fn({
      setTag(key, value) {
        tags[key] = value;
      },
    });
  },
}));

let tags: Record<string, string> = {};

const FAKE_DSN = "https://abc123@o0.ingest.sentry.io/0";

/** Recharge modil la pwòp — `initialized` se yon eta modil ki pèsiste. */
async function loadModule(dsn: string) {
  vi.resetModules();
  vi.stubEnv("VITE_SENTRY_DSN", dsn);
  const mod = await import("../sentry-browser");
  mod.initSentryClient();
  return mod;
}

beforeEach(() => {
  tags = {};
  captureException.mockClear();
  init.mockClear();
  vi.stubGlobal("window", {
    location: { pathname: "/restaurants/nk-food", search: "?next=/orders", hash: "#meni" },
  });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("captureExceptionClient", () => {
  it("pa voye anyen lè pa gen DSN — se eta pwodiksyon an jodi a", async () => {
    const { captureExceptionClient } = await loadModule("");
    captureExceptionClient(new Error("boom"));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("mete chemen an ak User-Agent la kòm tag", async () => {
    const { captureExceptionClient } = await loadModule(FAKE_DSN);
    const error = new Error("boom");
    captureExceptionClient(error);

    expect(captureException).toHaveBeenCalledWith(error);
    expect(tags.pathname).toBe("/restaurants/nk-food");
    expect(tags.user_agent).toBe("Mozilla/5.0 (compatible; Googlebot/2.1)");
  });

  it("pa janm mete `search` ni `hash` nan tag la", async () => {
    const { captureExceptionClient } = await loadModule(FAKE_DSN);
    captureExceptionClient(new Error("boom"));

    expect(tags.pathname).not.toContain("?");
    expect(tags.pathname).not.toContain("next=");
    expect(tags.pathname).not.toContain("#");
  });

  it("koupe yon User-Agent ki twò long nan 200 karaktè", async () => {
    vi.stubGlobal("navigator", { userAgent: "U".repeat(500) });
    const { captureExceptionClient } = await loadModule(FAKE_DSN);
    captureExceptionClient(new Error("boom"));

    expect(tags.user_agent).toHaveLength(200);
    expect(tags.user_agent.endsWith("…")).toBe(true);
  });

  it("kouri menm lè `window` pa egziste — erè ki soti nan money.ts / rpc-errors.ts", async () => {
    const { captureExceptionClient } = await loadModule(FAKE_DSN);
    vi.stubGlobal("window", undefined);
    captureExceptionClient(new Error("boom"));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(tags.pathname).toBeUndefined();
    expect(tags.user_agent).toBeDefined();
  });
});
