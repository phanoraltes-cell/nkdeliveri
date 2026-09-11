import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { applyErrorPageMeta, type DocumentLike, type ElementLike } from "../error-page-meta";

/**
 * Tès sa yo gade yon règ ki gen de bò, epi de bò yo gen pri diferan:
 *
 *   * Yon paj erè ki rete endeksab -> yon tit lèd nan Google. Kosmetik.
 *   * Yon paj ki AN SANTE ki resevwa `noindex` -> li disparèt nan Google.
 *
 * Se poutèt sa `ErrorComponent` rasin nan pa janm mete `noindex`: fòm erè a
 * ki rive nan boundary la pa pote okenn estati HTTP (wè describe anba a),
 * donk nou pa ka distenge yon 500 ak yon erè idratasyon, epi nan dout règ
 * la se non.
 */

/** Yon `<head>` fo, ase pou kòd la kouri tout bon — pa gen jsdom nan pwojè a. */
function fakeDocument(initialHead: { robots?: string; canonical?: string } = {}) {
  const head: { tag: string; attrs: Record<string, string> }[] = [];
  if (initialHead.robots !== undefined) {
    head.push({ tag: "meta", attrs: { name: "robots", content: initialHead.robots } });
  }
  if (initialHead.canonical !== undefined) {
    head.push({ tag: "link", attrs: { rel: "canonical", href: initialHead.canonical } });
  }

  // Chak eleman pote referans antre li a, menm sa ki soti nan
  // querySelector — se konsa yon vrè DOM konpòte l: retire yon eleman epi
  // re-ajoute l remete MENM eleman an. San sa, fo a t ap di kanonik la pa
  // ka retounen pandan nan yon vrè navigatè li retounen byen pwòp.
  const wrap = (entry: {
    tag: string;
    attrs: Record<string, string>;
  }): ElementLike & { __entry: unknown } => ({
    __entry: entry,
    getAttribute: (n) => entry.attrs[n] ?? null,
    setAttribute: (n, v) => {
      entry.attrs[n] = v;
    },
    remove: () => {
      const i = head.indexOf(entry);
      if (i >= 0) head.splice(i, 1);
    },
  });

  const doc: DocumentLike & { head_: typeof head } = {
    title: "Tit orijinal",
    head_: head,
    querySelector(sel) {
      const entry =
        sel === 'meta[name="robots"]'
          ? head.find((e) => e.tag === "meta" && e.attrs.name === "robots")
          : sel === 'link[rel="canonical"]'
            ? head.find((e) => e.tag === "link" && e.attrs.rel === "canonical")
            : undefined;
      return entry ? wrap(entry) : null;
    },
    createElement(tagName) {
      const entry = { tag: tagName, attrs: {} as Record<string, string> };
      // Eleman an pa nan head la ankò — se `head.appendChild` anba a ki
      // mete l la, menm jan ak yon vrè DOM.
      return wrap(entry);
    },
    head: {
      appendChild(node) {
        const entry = (
          node as ElementLike & { __entry?: { tag: string; attrs: Record<string, string> } }
        ).__entry;
        if (entry) head.push(entry);
      },
    },
  };
  return doc;
}

const robotsOf = (doc: ReturnType<typeof fakeDocument>) =>
  doc.head_.find((e) => e.tag === "meta" && e.attrs.name === "robots")?.attrs.content ?? null;
const canonicalOf = (doc: ReturnType<typeof fakeDocument>) =>
  doc.head_.find((e) => e.tag === "link" && e.attrs.rel === "canonical")?.attrs.href ?? null;

/**
 * Tès sa a se sèl rezon ki fè `ErrorComponent` rasin nan pase
 * `noindex: false` an di. Li pa yon tès sou kòd nou — se yon **gad sou yon
 * reyalite ekstèn** nou te mezire.
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

describe("applyErrorPageMeta — erè kliyan", () => {
  it("chanje tit la MEN li pa ajoute okenn balis robots", () => {
    const doc = fakeDocument({ canonical: "https://www.nkdeliveri.com/" });
    applyErrorPageMeta(doc, { title: "Erè — paj la pa disponib", noindex: false });

    expect(doc.title).toBe("Erè — paj la pa disponib");
    expect(robotsOf(doc)).toBeNull();
    // Kanonik la pa touche non plis — paj la an sante.
    expect(canonicalOf(doc)).toBe("https://www.nkdeliveri.com/");
  });

  it("remete tit la lè boundary la demonte", () => {
    const doc = fakeDocument();
    const cleanup = applyErrorPageMeta(doc, { title: "Erè", noindex: false });
    cleanup();
    expect(doc.title).toBe("Tit orijinal");
  });
});

describe("applyErrorPageMeta — repons sèvè an erè", () => {
  it("mete tit la EPI balis robots la", () => {
    const doc = fakeDocument();
    applyErrorPageMeta(doc, { title: "Erè — paj la pa disponib", noindex: true });

    expect(doc.title).toBe("Erè — paj la pa disponib");
    expect(robotsOf(doc)).toBe("noindex, nofollow");
  });

  it("retire kanonik la — li pa dwe pwente sou dakèy la", () => {
    const doc = fakeDocument({ canonical: "https://www.nkdeliveri.com/" });
    applyErrorPageMeta(doc, { title: "Erè", noindex: true });
    expect(canonicalOf(doc)).toBeNull();
  });

  it("balis la disparèt nan head la lè boundary la demonte", () => {
    const doc = fakeDocument({ canonical: "https://www.nkdeliveri.com/" });
    const cleanup = applyErrorPageMeta(doc, { title: "Erè", noindex: true });
    expect(robotsOf(doc)).toBe("noindex, nofollow");

    cleanup();

    // Se pwen an ki konte: san sa, `noindex` ta swiv moun nan sou chak paj
    // apre yon navigasyon kliyan.
    expect(robotsOf(doc)).toBeNull();
    expect(canonicalOf(doc)).toBe("https://www.nkdeliveri.com/");
    expect(doc.title).toBe("Tit orijinal");
  });

  it("remete yon balis robots ki te DEJA la nan valè li te genyen an", () => {
    const doc = fakeDocument({ robots: "index, follow" });
    const cleanup = applyErrorPageMeta(doc, { title: "Erè", noindex: true });
    expect(robotsOf(doc)).toBe("noindex, nofollow");

    cleanup();
    expect(robotsOf(doc)).toBe("index, follow");
  });
});
