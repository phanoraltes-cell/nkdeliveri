/**
 * OSRM (Open Source Routing Machine) — direksyon woutye ant de pwen.
 *
 * ---------------------------------------------------------------------------
 * DEPANDANS EKSTÈN KI KA TONBE
 *
 * San `VITE_OSRM_URL`, nou tonbe sou `router.project-osrm.org` — sèvè demo
 * piblik la, ki limite debi epi ki di eksplisitman li PA fèt pou trafik
 * pwodiksyon. Mezire sou build pwodiksyon an (chunk `useRoute-CZ8U2Z5w.js`):
 * se valè sekou a ki la, donk varyab la pa poze.
 *
 * Konsekans: yon livrè ka pèdi itinerè l nenpòt kilè, san avètisman. Anvan,
 * `delivery-route-info.tsx` te fè `if (!route.data) return null` — livrè a
 * pa t wè ANYEN. Kounye a:
 *
 *   * yon delè maksimòm (yon `fetch` ki pann pa janm rezoud, epi `retry` yon
 *     bibliyotèk pa ede sou yon pwomès ki pa janm fini);
 *   * erè yo klase (`rate-limited`, `timeout`, rès la) epi jounalize, konsa
 *     nou wè si limitasyon an kòmanse AVAN livrè yo rele nou;
 *   * yon chemen sekou: distans a vòl dwazo, make klèman kòm apwoksimatif,
 *     plis yon lyen nan yon app kat ekstèn.
 *
 * Pati enfrastrikti a rete pou Altes: ebèje OSRM ak yon ekstrè Ayiti epi
 * poze `VITE_OSRM_URL`. Fòm API a idantik, okenn chanjman kòd.
 */

import { reportDegradation } from "@/lib/report-error";

const OSRM_BASE = import.meta.env.VITE_OSRM_URL || "https://router.project-osrm.org";
const USING_PUBLIC_DEMO = !import.meta.env.VITE_OSRM_URL;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — a driver's position ages fast, no point caching longer
/**
 * Yon livrè ap gade ekran l pandan l ap kondi. Apre 8 segonn san repons, yon
 * distans apwoksimatif tou swit vo plis pase yon wout egzak ki pa janm rive.
 */
const OSRM_TIMEOUT_MS = 8000;

if (import.meta.env.DEV && USING_PUBLIC_DEMO) {
  console.warn(
    "[routing] VITE_OSRM_URL pa poze — n ap sèvi ak sèvè demo piblik la " +
      "(router.project-osrm.org), ki limite debi epi ki pa fèt pou pwodiksyon.",
  );
}

export type RoutePoint = { lat: number; lng: number };
export type RouteResult = {
  /** [lat, lng] pairs, ready to hand straight to a Leaflet <Polyline positions=...>. */
  path: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
};

type CacheEntry = { value: RouteResult | null; ts: number };
const cache = new Map<string, CacheEntry>();

// Rounds to a ~50m grid so GPS jitter between consecutive driver pings
// reuses the same cached route instead of re-requesting an almost-identical one.
const round = (n: number) => Math.round(n * 2000) / 2000;

function keyFor(from: RoutePoint, to: RoutePoint) {
  return `${round(from.lat)},${round(from.lng)}|${round(to.lat)},${round(to.lng)}`;
}

/** Rezon yon itinerè pa disponib — sa ki deside mesaj livrè a wè. */
export type RouteFailureKind = "rate-limited" | "timeout" | "unavailable";

export class RouteUnavailableError extends Error {
  readonly kind: RouteFailureKind;
  constructor(kind: RouteFailureKind, message: string) {
    super(message);
    this.name = "RouteUnavailableError";
    this.kind = kind;
  }
}

const EARTH_RADIUS_M = 6371000;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

/**
 * Distans a vòl dwazo (aversin). Se chemen sekou a lè OSRM pa reponn.
 *
 * Li TOUJOU pi kout pase vrè wout la — se poutèt sa entèfas la dwe di
 * klèman se yon apwoksimasyon. Yon chif ki sanble egzak men ki fo pi mal
 * pase yon chif ki anonse tèt li kòm apeprè.
 */
export function straightLineMeters(from: RoutePoint, to: RoutePoint): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Lyen nan yon app kat ekstèn — dènye chemen sekou lè nou pa ka trase anyen. */
export function externalDirectionsUrl(from: RoutePoint, to: RoutePoint): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}

export async function getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null> {
  const key = keyFor(from, to);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const url = `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    const error = new RouteUnavailableError(
      timedOut ? "timeout" : "unavailable",
      timedOut ? `OSRM pa reponn apre ${OSRM_TIMEOUT_MS} ms` : "OSRM pa jwenn",
    );
    reportDegradation(
      `[routing] ${error.message}${USING_PUBLIC_DEMO ? " (sèvè demo)" : ""}`,
      cause,
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 429 = limitasyon debi. Sou sèvè demo a se sa k ap rive an premye, epi
    // se sa nou vle wè nan Sentry anvan livrè yo rele nou.
    const kind: RouteFailureKind = res.status === 429 ? "rate-limited" : "unavailable";
    const error = new RouteUnavailableError(kind, `OSRM ${res.status}`);
    reportDegradation(
      `[routing] OSRM ${res.status}${USING_PUBLIC_DEMO ? " (sèvè demo piblik)" : ""}`,
      error,
    );
    throw error;
  }

  const body = (await res.json()) as {
    code: string;
    routes?: Array<{
      geometry: { coordinates: [number, number][] };
      distance: number;
      duration: number;
    }>;
  };

  const route = body.code === "Ok" ? body.routes?.[0] : undefined;
  const result: RouteResult | null = route
    ? {
        path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        distanceMeters: route.distance,
        durationSeconds: route.duration,
      }
    : null;

  cache.set(key, { value: result, ts: Date.now() });
  return result;
}
