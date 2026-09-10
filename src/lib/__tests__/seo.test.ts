import { describe, it, expect } from "vitest";
import { fitTitle, MAX_TITLE_LENGTH, pageMeta, noIndexMeta } from "../seo";

/**
 * Tès sa yo soti nan yon bug reyèl: Google te endekse dakèy la ak tit
 * « Yon erè rive — NK Deliveri ». Yo kenbe de bagay — longè tit yo, epi
 * fòm kanonik la (de fòm pou menm paj se kontni doub).
 */

describe("fitTitle", () => {
  const SUFFIX = " — Meni ak livrezon | NK Deliveri";

  it("kenbe tit konplè a lè li antre", () => {
    const name = "NK Food";
    expect(fitTitle([`${name}${SUFFIX}`, name])).toBe(`${name}${SUFFIX}`);
  });

  it("tonbe sou kandida ki swiv la lè premye a twò long", () => {
    // 30 karaktè + sifiks 33 = 63, twò long. Dezyèm kandida a antre.
    const name = "Restoran Gou Laky Gonaïves Ayi";
    const result = fitTitle([`${name}${SUFFIX}`, `${name} — Meni ak livrezon`, name]);
    expect(result).toBe(`${name} — Meni ak livrezon`);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it("koupe ak yon eleps sèlman lè menm dènye kandida a twò long", () => {
    const name = "A".repeat(80);
    const result = fitTitle([`${name}${SUFFIX}`, name]);
    expect(result.length).toBe(MAX_TITLE_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  it("pa janm depase 60 karaktè, kèlkeswa antre a", () => {
    for (const name of ["", "A", "Ragoût Pye Bèf ak Diri Kole Kreyòl Tradisyonèl Gonaïves"]) {
      expect(fitTitle([`${name}${SUFFIX}`, name]).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    }
  });
});

describe("kanonik", () => {
  it("dakèy la sèvi ak yon sèl fòm — ak bar final la, menm ak sitemap la", () => {
    // Anvan, dakèy la te deklare `https://www.nkdeliveri.com` (san bar)
    // pandan sitemap la te di `https://www.nkdeliveri.com/` (ak bar). De
    // fòm pou menm paj la.
    const meta = pageMeta({ title: "T", description: "D", path: "/" });
    const canonical = meta.links.find((l) => l.rel === "canonical")?.href;
    expect(canonical).toBe("https://www.nkdeliveri.com/");
  });

  it("og:url ak kanonik la toujou menm valè a", () => {
    const meta = pageMeta({ title: "T", description: "D", path: "/restaurants" });
    const canonical = meta.links.find((l) => l.rel === "canonical")?.href;
    const ogUrl = meta.meta.find((m) => "property" in m && m.property === "og:url");
    expect(ogUrl && "content" in ogUrl ? ogUrl.content : null).toBe(canonical);
  });
});

describe("noIndexMeta", () => {
  it("bay noindex EPI okenn kanonik — yon paj prive pa dwe deklare youn", () => {
    const meta = noIndexMeta("Panye");
    const robots = meta.meta.find((m) => "name" in m && m.name === "robots");
    expect(robots && "content" in robots ? robots.content : null).toBe("noindex, nofollow");
    expect("links" in meta).toBe(false);
  });
});
