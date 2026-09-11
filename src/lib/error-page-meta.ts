/**
 * META PAJ ERÈ — sa `ErrorBoundary` rasin nan aplike, epi kijan li defèt li.
 *
 * ---------------------------------------------------------------------------
 * POUKISA FICHYE SA A EGZISTE
 *
 * Komit 55562ff te korije yon vrè bug: Google te endekse dakèy la ak tit
 * « Yon erè rive — NK Deliveri ». Men koreksyon an te twò laj — li te
 * enjekte `noindex` sou CHAK erè ErrorBoundary trape.
 *
 * ErrorBoundary React la pa deklanche sèlman sou yon erè done. Li deklanche
 * sou yon **erè idratasyon** tou — yon ekà ant HTML sèvè a voye a ak sa
 * React pwodwi nan navigatè a. Sa rive an pwodiksyon, sou paj ki an sante
 * nèt.
 *
 *   Yon tit ki lèd se yon pwoblèm kosmetik.
 *   Yon dakèy ki dezendekse pa youn.
 *
 * Donk de aksyon yo separe:
 *   * TIT LA — toujou. Se li ki te lakòz bug endekse a, li pa gen okenn
 *     efè segondè.
 *   * `noindex` — SÈLMAN lè erè a soti nan yon repons sèvè.
 *
 * ---------------------------------------------------------------------------
 * NÒT SOU API A
 *
 * Espesifikasyon orijinal la te mande `isRouteErrorResponse(error)`.
 * Fonksyon sa a se yon API **React Router**; TanStack Router pa genyen l
 * (li eksporte `isNotFound`, `isRedirect`, `isMatch` — verifye nan
 * node_modules/@tanstack/react-router).
 *
 * ---------------------------------------------------------------------------
 * POUKISA PA GEN `shouldNoindex` ANKÒ — SA NOU MEZIRE
 *
 * Premye vèsyon fichye sa a te gen yon fonksyon `shouldNoindex(error)` ki
 * t ap chèche yon fòm `Response` sou erè a. Nou te mezire fòm reyèl la olye
 * nou devine l (@tanstack/router-core 1.171.15):
 *
 *   * `dehydrateMatch` voye `match.error` nan seroval ak
 *     `ShallowErrorPlugin`. Plugin sa a serialize SÈLMAN `message`, epi li
 *     deserialize kòm `new Error(message)`.
 *   * Yon erè ki gen `status`/`statusText` anplis: apre wonn nan, chan sa yo
 *     DISPARÈT. Kle ki rete yo se `["stack", "message"]` sèlman.
 *   * Yon vrè `Response`: li pa menm ka serialize — seroval jete
 *     « Seroval Error (step: 1) ». Yon `Response` pa janm travèse SSR.
 *   * Okenn kòd nan `src/` pa lanse yon `Response` non plis
 *     (`grep -rn "throw new Response" src/` = vid), donk menm sou yon
 *     navigasyon kliyan — kote chajè a kouri nan navigatè a epi pwototip la
 *     rete entak — branch lan pa t ap deklanche.
 *
 * Donk toude branch yo te mouri: `shouldNoindex` pa t ka retounen `true`
 * sou okenn chemen ki egziste. Yon branch ki pa janm deklanche bay yon fo
 * enpresyon kouvèti, donk nou retire l.
 *
 * Rezilta a se règ prudans la, aplike san kondisyon: `ErrorComponent`
 * rasin nan chanje TIT la sèlman, li pa janm mete `noindex`. Sa ki gade
 * endeksasyon an se **estati HTTP la** (500 / 404), epi li deja kòrèk.
 *
 * `noindex: true` rete VIVAN sou yon sèl chemen: `NotFoundComponent` rasin
 * nan, kote 404 la sèten.
 *
 * Si yon jou yon chajè lanse yon vrè `Response`, oswa si TanStack konsève
 * `status` nan serializasyon an, tès
 * `error-page-meta.test.ts > fòm erè a jan li rive vre` ap tonbe — se la
 * pou reouvri kesyon an.
 */

/**
 * Ti sou-ansanm DOM nou bezwen. Yon entèfas estriktirèl (pa `Document`)
 * pou tès yo ka pase yon objè senp — pa gen jsdom nan pwojè a, epi ajoute
 * youn jis pou sa a ta yon depandans an plis pou anyen.
 */
export type ElementLike = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
};

export type DocumentLike = {
  title: string;
  querySelector(selectors: string): ElementLike | null;
  createElement(tagName: string): ElementLike;
  head: { appendChild(node: ElementLike): void };
};

/**
 * Aplike meta paj erè a epi retounen yon fonksyon ki DEFÈ tout bagay.
 *
 * Netwayaj la pa yon detay: si boundary la enjekte yon balis epi moun nan
 * navige yon lòt kote SAN rechaje paj la (navigasyon kliyan), balis la ta
 * rete nan `<head>` epi li ta swiv moun nan sou chak paj apre sa. Yon
 * `noindex` ki kole konsa dezendekse paj ki pa gen anyen pou wè ak erè a.
 */
export function applyErrorPageMeta(
  doc: DocumentLike,
  options: { title: string; noindex: boolean },
): () => void {
  const previousTitle = doc.title;
  doc.title = options.title;

  if (!options.noindex) {
    // Erè kliyan (idratasyon elatriye): tit sèlman. Nou pa touche ni
    // `robots` ni `canonical`.
    return () => {
      doc.title = previousTitle;
    };
  }

  // --- robots ---
  let injectedRobots: ElementLike | null = null;
  let previousRobots: string | null = null;
  const existingRobots = doc.querySelector('meta[name="robots"]');
  if (existingRobots) {
    previousRobots = existingRobots.getAttribute("content");
    existingRobots.setAttribute("content", "noindex, nofollow");
  } else {
    injectedRobots = doc.createElement("meta");
    injectedRobots.setAttribute("name", "robots");
    injectedRobots.setAttribute("content", "noindex, nofollow");
    doc.head.appendChild(injectedRobots);
  }

  // --- canonical ---
  // Yon paj erè ki deklare dakèy la kòm kanonik li ap mande Google endekse
  // kontni erè a SOU URL dakèy la — se egzakteman sa ki te pase.
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) canonical.remove();

  return () => {
    doc.title = previousTitle;

    if (injectedRobots) {
      injectedRobots.remove();
    } else if (existingRobots) {
      // Remete valè a jan li te ye — enkli lè li pa t gen okenn `content`.
      if (previousRobots === null) existingRobots.remove();
      else existingRobots.setAttribute("content", previousRobots);
    }

    if (canonical) doc.head.appendChild(canonical);
  };
}
