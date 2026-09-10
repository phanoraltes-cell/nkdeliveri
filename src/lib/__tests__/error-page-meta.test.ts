import { describe, it, expect } from "vitest";
import {
  applyErrorPageMeta,
  shouldNoindex,
  type DocumentLike,
  type ElementLike,
} from "../error-page-meta";

/**
 * Tès sa yo gade yon règ ki gen de bò, epi de bò yo gen pri diferan:
 *
 *   * Yon paj erè ki rete endeksab -> yon tit lèd nan Google. Kosmetik.
 *   * Yon paj ki AN SANTE ki resevwa `noindex` -> li disparèt nan Google.
 *
 * Se poutèt sa `shouldNoindex` konsèvatè: nan dout, li di non.
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

describe("shouldNoindex — repons sèvè", () => {
  it("vre pou yon 500 lanse kòm Response", () => {
    expect(shouldNoindex(new Response("boom", { status: 500 }))).toBe(true);
  });

  it("vre pou yon 404 lanse kòm Response", () => {
    expect(shouldNoindex(new Response(null, { status: 404 }))).toBe(true);
  });

  it("fo pou yon repons ki reyisi", () => {
    expect(shouldNoindex(new Response("ok", { status: 200 }))).toBe(false);
  });
});

describe("shouldNoindex — erè kliyan (se yo ki te lakòz pwoblèm nan)", () => {
  it("fo pou yon erè idratasyon", () => {
    expect(shouldNoindex(new Error("Hydration failed because the server rendered HTML"))).toBe(
      false,
    );
  });

  it("fo pou yon eksepsyon òdinè nan yon konpozan", () => {
    expect(shouldNoindex(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("fo pou yon erè Supabase — li pa gen fòm yon Response", () => {
    // PostgrestError: code/message/details/hint. Okenn `status`.
    expect(shouldNoindex({ code: "PGRST116", message: "no rows", details: null, hint: null })).toBe(
      false,
    );
  });

  it("fo pou yon objè ki gen `status` sèlman, san rès fòm Response la", () => {
    // Konsèvatè eksprè: nan dout, pa dezendekse.
    expect(shouldNoindex({ status: 500 })).toBe(false);
  });

  it("fo pou null, undefined ak yon chèn", () => {
    expect(shouldNoindex(null)).toBe(false);
    expect(shouldNoindex(undefined)).toBe(false);
    expect(shouldNoindex("boom")).toBe(false);
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
