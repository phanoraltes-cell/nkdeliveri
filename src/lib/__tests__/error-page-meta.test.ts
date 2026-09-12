import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { applyErrorPageMeta, type DocumentLike } from "../error-page-meta";

/**
 * Tès sa yo gade yon règ ki gen de bò, epi de bò yo gen pri diferan:
 *
 *   * Yon paj erè ki rete endeksab -> yon tit lèd nan Google. Kosmetik.
 *   * Yon paj ki AN SANTE ki resevwa `noindex` -> li disparèt nan Google.
 *
 * Se poutèt sa `applyErrorPageMeta` pa touche `robots` ditou: fòm erè a ki
 * rive nan boundary la pa pote okenn estati HTTP (wè describe anba a), donk
 * nou pa ka distenge yon 500 ak yon erè idratasyon, epi nan dout règ la se
 * non. Pou yon 404, se `head()` rasin nan ki mete `noindex` depi SSR a.
 */

/**
 * Tès sa a se sèl rezon ki fè boundary la pa gen okenn lojik `noindex`
 * ditou. Li pa yon tès sou kòd nou — se yon **gad sou yon reyalite
 * ekstèn** nou te mezire.
 *
 * Mezi a (@tanstack/router-core 1.171.15, wonn konplè
 * `toCrossJSON`/`fromCrossJSON` ak `defaultSerovalPlugins`):
 *
 *   Object.assign(new Error("Supabase down"), { status: 500, statusText: "Internal" })
 *     -> apre wonn nan: constructor = Error, kle yo = ["stack", "message"],
 *        status = absan, statusText = absan, ok = absan, headers = absan.
 *
 *   new Response("boom", { status: 500 })
 *     -> serializasyon an TONBE: « Seroval Error (step: 1) ».
 *
 * Nou pa ka refè wonn nan nan yon tès: ni `seroval` ni plugin yo pa yon
 * depandans dirèk, epi `defaultSerovalPlugins` pa nan sifas eksporte
 * router-core la (`exports` = ".", "./ssr/server", "./ssr/client",
 * "./isServer", "./scroll-restoration-script"). Enpòte yon chemen entèn ta
 * yon depandans sou entèn yon bibliyotèk.
 *
 * Donk nou gade sous plugin lan dirèkteman. Si TanStack chanje l pou l
 * konsève `status`, tès sa a tonbe — epi se lè sa a pou reouvri desizyon an.
 */
describe("fòm erè a jan li rive vre", () => {
  const PLUGIN_PATH = resolve(
    process.cwd(),
    "node_modules/@tanstack/router-core/dist/esm/ssr/serializer/ShallowErrorPlugin.js",
  );

  function pluginSource(): string {
    try {
      return readFileSync(PLUGIN_PATH, "utf8");
    } catch {
      throw new Error(
        `ShallowErrorPlugin pa jwenn nan ${PLUGIN_PATH}. Serializatè TanStack la deplase oswa chanje — ` +
          "remezire fòm erè a ki rive nan ErrorBoundary rasin nan anvan ou chanje tès sa a. " +
          "Wè src/lib/error-page-meta.ts.",
      );
    }
  }

  it("serializatè a rekonstwi yon `new Error(message)` tou nèf", () => {
    // Se la tout chan anplis yo pèdi. Yon `status` ki te sou erè a anvan
    // SSR pa egziste ankò lè boundary la resevwa l.
    expect(pluginSource()).toMatch(/deserialize\([^)]*\)\s*\{\s*return new Error\(/);
  });

  it("serializatè a pa transpòte okenn estati HTTP", () => {
    const src = pluginSource();
    for (const field of ["status", "statusText", "headers"]) {
      expect(src).not.toContain(field);
    }
  });

  it("yon erè ki gen yon estati pèdi l — se fòm sa a boundary la wè", () => {
    // Repwodiksyon fòm lan jan mezi a te bay li: `new Error(message)`.
    const thrown = Object.assign(new Error("Supabase down"), {
      status: 500,
      statusText: "Internal Server Error",
    });
    const arrived = new Error(thrown.message);

    expect(arrived.message).toBe("Supabase down");
    expect("status" in arrived).toBe(false);
    expect("statusText" in arrived).toBe(false);
  });
});

describe("applyErrorPageMeta", () => {
  /** Yon `document` fo — pa gen jsdom nan pwojè a, epi nou pa bezwen youn. */
  const fakeDocument = (): DocumentLike => ({ title: "Tit orijinal" });

  it("mete tit paj erè a", () => {
    const doc = fakeDocument();
    applyErrorPageMeta(doc, { title: "Erè — paj la pa disponib" });
    expect(doc.title).toBe("Erè — paj la pa disponib");
  });

  it("remete ansyen tit la lè boundary la demonte", () => {
    // Se pwen an ki konte: san sa, tit paj erè a t ap swiv moun nan sou
    // chak paj apre yon navigasyon kliyan — menm fanmi defo ak bug
    // « Yon erè rive » ki te endekse a.
    const doc = fakeDocument();
    const cleanup = applyErrorPageMeta(doc, { title: "Erè" });
    cleanup();
    expect(doc.title).toBe("Tit orijinal");
  });
});
