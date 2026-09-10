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
 * Espesifikasyon an mande `isRouteErrorResponse(error)`. Fonksyon sa a se
 * yon API **React Router**; TanStack Router pa genyen l (li eksporte
 * `isNotFound`, `isRedirect`, `isMatch` — verifye nan
 * node_modules/@tanstack/react-router). Nou tcheke fòm nan dirèkteman.
 */

/** Sa yon `Response` ki travèse SSR ka sanble apre serializasyon. */
function isResponseShaped(value: object): boolean {
  // Nou mande PLIS pase yon `status`: yon `ok`, `statusText` oswa `headers`
  // tou. Sa a se yon chwa konsèvatè EKSPRÈ — nan dout, pa mete `noindex`.
  // Yon fo pozitif dezendekse yon paj ki an sante; yon fo negatif kite yon
  // paj erè ak yon tit netral, san mak, ki pa fè mal. Erè Supabase
  // (PostgrestError: code/message/details/hint) pa gen okenn nan chan sa yo.
  return "status" in value && ("ok" in value || "statusText" in value || "headers" in value);
}

/**
 * Vre sèlman lè erè a se yon repons sèvè an erè.
 *
 * FO pou: erè idratasyon, eksepsyon nan yon konpozan, erè rezo kliyan —
 * tout bagay ki ka rive sou yon paj ki an sante.
 */
export function shouldNoindex(error: unknown): boolean {
  if (error instanceof Response) return error.status >= 400;
  if (typeof error === "object" && error !== null && isResponseShaped(error)) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && status >= 400;
  }
  return false;
}

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
