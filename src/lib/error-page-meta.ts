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
 * Donk fichye sa a fè YON SÈL bagay: li mete tit la, epi li remete l. Se
 * tit la ki te lakòz bug endekse a, epi li pa gen okenn efè segondè.
 *
 * Li pa touche ni `robots` ni `canonical` — wè de seksyon anba yo pou de
 * rezon endepandan.
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
 * ---------------------------------------------------------------------------
 * POUKISA PA GEN OPSYON `noindex` ANKÒ NON PLIS
 *
 * `NotFoundComponent` te dènye apèl la ak `noindex: true`. Depi `head()`
 * rasin nan sèvi tit la ak `noindex` la pou yon 404 DEPI SSR A, konpozan an
 * pa manyen DOM la ankò — epi branch lan vin mouri menm jan ak lòt la.
 *
 * Se pa sèlman kòd mouri, se te vin danjere: netwayaj la anrejistre valè
 * `robots` ki te LA a. Ak `noindex` ki soti nan SSR kounye a, valè sa a se
 * `noindex, nofollow`, epi netwayaj la t ap remete l lè moun nan kite paj
 * la — ki ka rive APRE `head()` fin mete `index, follow` pou paj
 * destinasyon an. Yon paj an sante ki pran yon `noindex`: egzakteman defo a
 * tout fichye sa a egziste pou anpeche.
 *
 * De mekanis k ap ekri menm balis la, se youn twòp. `HeadContent` genyen l.
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
export type DocumentLike = {
  title: string;
};

/**
 * Mete tit paj erè a epi retounen yon fonksyon ki REMETE ansyen an.
 *
 * Remèt la pa yon detay: `ErrorBoundary` la ka demonte san paj la rechaje
 * (navigasyon kliyan), epi san sa tit paj erè a ta swiv moun nan sou chak
 * paj apre sa — menm fanmi defo ak bug endekse orijinal la.
 */
export function applyErrorPageMeta(doc: DocumentLike, options: { title: string }): () => void {
  const previousTitle = doc.title;
  doc.title = options.title;
  return () => {
    doc.title = previousTitle;
  };
}
