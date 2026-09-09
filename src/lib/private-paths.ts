/**
 * CHEMEN KI PA DWE JANM ENDEKSE — yon sèl sous verite.
 *
 * Lis sa a sèvi nan DE kote ki dwe toujou dakò:
 *   1. `src/routes/robots[.]txt.ts` — sa nou DI robo yo.
 *   2. `src/server.ts` — antèt `X-Robots-Tag` la, sa nou ENPOZE yo.
 *
 * Poukisa de kouch, epi poukisa dezyèm nan enpòtan:
 *
 * `robots.txt` se yon DEMANN, li pa yon mekanis sekirite — yon robo ki pa
 * respekte l endekse kanmenm. Epi nan ka nou an gen yon pwoblèm konkrè:
 * Cloudflare enjekte pwòp blòk jere pa l anwo pa nou an, ak yon dezyèm
 * gwoup `User-agent: *` ki di `Allow: /`. Google fizyone gwoup ki gen menm
 * user-agent (dokimante), donk pou li règ nou yo aplike. Men yon robo ki
 * pran PREMYE gwoup ki matche a sèlman wè `Allow: /` san okenn `Disallow`.
 *
 * Antèt `X-Robots-Tag` la pa gen pwoblèm sa a: li vwayaje ak CHAK repons,
 * li pa depann de yon fichye yon lòt sistèm ka modifye, epi li travay sou
 * repons ki pa HTML tou (`/api/*`), kote yon balis `<meta name="robots">`
 * pa ta menm ka egziste.
 *
 * Sa a PA ranplase otorizasyon sèvè a. Paj prive yo rete pwoteje pa RLS ak
 * gad wòl yo — lis sa a se sèlman pou endeksaj.
 */

/**
 * Prefiks chemen ki prive. Yon chemen prive si li egal youn nan yo oswa si
 * li kòmanse ak youn nan yo swiv pa `/`.
 *
 * `/auth` ladan l espre: paj konekte/enskri yo pa gen okenn valè rechèch,
 * epi yo kreye kontni doub ak paramèt `?next=` yo.
 */
export const PRIVATE_PATH_PREFIXES = [
  "/dashboard",
  "/admin",
  "/api",
  "/private",
  "/auth",
  "/checkout",
  "/orders",
  "/profile",
] as const;

/** Vre si chemen an pa dwe endekse. */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
