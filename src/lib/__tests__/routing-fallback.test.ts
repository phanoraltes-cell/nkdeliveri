import { describe, it, expect } from "vitest";
import { straightLineMeters, externalDirectionsUrl } from "@/services/routing";

/**
 * Chemen sekou a lè OSRM tonbe. Li pa yon detay kosmetik: anvan, yon livrè
 * k ap kondi pa t wè ANYEN lè sèvis itinerè a pa t reponn
 * (`delivery-route-info.tsx` te fè `return null`). Kalkil sa a se sa ki
 * ranplase yon ekran vid pa yon chif itil.
 *
 * Se poutèt sa li teste: si li bay yon move chif, livrè a pran yon move
 * desizyon sou wout — epi pèsonn pa ta wè l, paske li parèt SÈLMAN lè yon
 * lòt bagay deja an pàn.
 */
describe("straightLineMeters", () => {
  // Gonaïves (baz NK Deliveri) -> Pòtoprens. Distans a vòl dwazo reyèl
  // ~100 km; nou kenbe yon fouchèt laj paske se yon apwoksimasyon ki
  // anonse tèt li kòm sa.
  const gonaives = { lat: 19.4489, lng: -72.689 };
  const portAuPrince = { lat: 18.5944, lng: -72.3074 };

  it("bay yon distans reyalis ant de vil ann Ayiti", () => {
    const m = straightLineMeters(gonaives, portAuPrince);
    expect(m).toBeGreaterThan(95_000);
    expect(m).toBeLessThan(110_000);
  });

  it("bay zewo pou menm pwen an — pa yon NaN", () => {
    const m = straightLineMeters(gonaives, gonaives);
    expect(m).toBe(0);
    expect(Number.isNaN(m)).toBe(false);
  });

  it("simetrik — lòd la pa chanje distans lan", () => {
    expect(straightLineMeters(gonaives, portAuPrince)).toBeCloseTo(
      straightLineMeters(portAuPrince, gonaives),
      6,
    );
  });

  it("presi sou kout distans — se ka a ki pi frekan pou yon livrè", () => {
    // ~1 degre latitid = ~111 km, donk 0.009 degre = ~1 km.
    const a = { lat: 19.4489, lng: -72.689 };
    const b = { lat: 19.4579, lng: -72.689 };
    const m = straightLineMeters(a, b);
    expect(m).toBeGreaterThan(950);
    expect(m).toBeLessThan(1050);
  });

  it("toujou bay yon nonm fini, menm sou pwen opoze sou glòb la", () => {
    // `Math.sqrt` ka depase 1 ak erè vigil flotan; gad `Math.min(1, …)` la
    // anpeche `Math.asin` retounen NaN.
    const m = straightLineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(19_000_000);
  });
});

describe("externalDirectionsUrl", () => {
  it("bay yon lyen kat ki gen de pwen yo ak mòd kondi a", () => {
    const url = externalDirectionsUrl({ lat: 19.4489, lng: -72.689 }, { lat: 19.45, lng: -72.7 });
    expect(url).toContain("origin=19.4489,-72.689");
    expect(url).toContain("destination=19.45,-72.7");
    expect(url).toContain("travelmode=driving");
  });
});
