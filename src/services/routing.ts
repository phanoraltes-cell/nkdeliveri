/**
 * OSRM (Open Source Routing Machine) — driving directions between two points.
 *
 * The public router.project-osrm.org demo server is rate-limited and
 * explicitly not meant for production traffic. Point VITE_OSRM_URL at a
 * self-hosted OSRM instance (Docker image + a Haiti .osm.pbf extract)
 * before real launch — the API shape is identical, no code changes needed.
 */

const OSRM_BASE = import.meta.env.VITE_OSRM_URL || "https://router.project-osrm.org";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — a driver's position ages fast, no point caching longer

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

export async function getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null> {
  const key = keyFor(from, to);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const url = `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
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
