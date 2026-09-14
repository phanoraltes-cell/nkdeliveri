/**
 * MÈTÒD KI PA DEKLARE SOU YON WOUT `/api/*` — 405, pa kokiy SPA a.
 *
 * Mezire an pwodiksyon anvan koreksyon an:
 *
 *   GET https://www.nkdeliveri.com/api/admin/ai
 *     → HTTP 200, Content-Type: text/html, kò a = <!DOCTYPE html>…
 *
 * Wout la deklare SÈLMAN yon `POST`. Yon `GET` pa matche okenn handler,
 * donk routè a tonbe sou aplikasyon an epi li rann kokiy HTML la ak 200.
 *
 * Okenn done pa fuite — chèn otorizasyon POST la solid epi li rete entak
 * (api.admin.ai.ts: Bearer obligatwa → auth.getClaims → wòl nan
 * ["admin","super_admin"] → 401/403). Se ijyèn, pa yon twou. Men yon
 * kliyan API ki resevwa 200 ak HTML sou yon move mètòd pa gen mwayen
 * konnen sa l fè mal, epi yon zouti sirveyans ta konte l kòm yon siksè.
 *
 * Yon sèl kote pou tout wout yo — pa wout pa wout. Konsa yon nouvo wout
 * `/api/*` pa ka bliye l: li jis anvlope handler li yo.
 *
 * `OPTIONS` reponn 204 ak menm antèt `Allow` la: se repons ki kòrèk pou yon
 * demann dekouvèt, epi li pa yon erè.
 */

/** Sa yon handler wout TanStack resevwa — sèl chan nou bezwen isit la. */
type HandlerContext = { request: Request };
type ApiHandler = (ctx: HandlerContext) => Response | Promise<Response>;

/**
 * Mètòd nou reponn eksplisitman. `HEAD` pa ladan l eksprè: espesifikasyon
 * HTTP la mande yon sèvè ki sipòte `GET` sipòte `HEAD` tou, epi routè a
 * jere sa poukont li — deklare yon `HEAD` ki bay 405 ta kase règ la.
 */
const HANDLED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type HandledMethod = (typeof HANDLED_METHODS)[number];

/**
 * Anvlope handler yon wout `/api/*` pou tout mètòd ki pa deklare bay 405.
 *
 * @example
 *   server: { handlers: apiMethods({ POST: async ({ request }) => … }) }
 */
export function apiMethods<T extends Partial<Record<HandledMethod, ApiHandler>>>(
  handlers: T,
): T & Record<string, ApiHandler> {
  const declared = Object.keys(handlers) as HandledMethod[];
  // `Allow` dwe anonse tout sa wout la aksepte tout bon, enkli OPTIONS.
  const allow = [...declared, "OPTIONS"].join(", ");

  const methodNotAllowed: ApiHandler = () =>
    new Response(null, { status: 405, headers: { Allow: allow } });

  const out: Record<string, ApiHandler> = { ...(handlers as Record<string, ApiHandler>) };
  for (const method of HANDLED_METHODS) {
    if (!(method in out)) out[method] = methodNotAllowed;
  }
  out.OPTIONS = () => new Response(null, { status: 204, headers: { Allow: allow } });

  return out as T & Record<string, ApiHandler>;
}
