/**
 * Nominatim (OpenStreetMap) geocoding — address <-> coordinates.
 *
 * The public nominatim.openstreetmap.org instance enforces a strict usage
 * policy: max ~1 request/second, no heavy/production traffic. This module
 * throttles every call to respect that and caches results in localStorage
 * so a given address is only ever looked up once. Before real production
 * launch, point VITE_NOMINATIM_URL at a self-hosted Nominatim instance (or
 * a paid provider) to lift that ceiling.
 */

const NOMINATIM_BASE = import.meta.env.VITE_NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const MIN_INTERVAL_MS = 1100;
const CACHE_KEY = "nk-geocode-cache-v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — street addresses rarely move

export type GeocodeResult = { lat: number; lng: number; displayName: string };

type CacheEntry<T> = { value: T; ts: number };
type Cache = Record<string, CacheEntry<unknown>>;

function readCache(): Cache {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(cache: Cache) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full/unavailable — the cache is a pure optimization, safe to drop
  }
}

function getCached<T>(key: string): T | undefined {
  const entry = readCache()[key];
  if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return undefined;
  return entry.value as T;
}

function setCached<T>(key: string, value: T) {
  const cache = readCache();
  cache[key] = { value, ts: Date.now() };
  writeCache(cache);
}

// Serializes every Nominatim call through one queue so concurrent callers
// (e.g. several components mounting at once) never exceed 1 req/sec.
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Address -> coordinates. Returns null if nothing matched (also cached, so a typo isn't re-queried on every render). */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address.trim();
  if (!q) return null;
  const cacheKey = `fwd:${q.toLowerCase()}`;
  const cached = getCached<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) return cached;

  return throttled(async () => {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=1&countrycodes=ht&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const result: GeocodeResult | null = rows.length
      ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon), displayName: rows[0].display_name }
      : null;
    setCached(cacheKey, result);
    return result;
  });
}

/** Coordinates -> a human-readable address. Returns null if Nominatim has nothing for that point. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const cacheKey = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = getCached<string | null>(cacheKey);
  if (cached !== undefined) return cached;

  return throttled(async () => {
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const row = (await res.json()) as { display_name?: string };
    const result = row.display_name ?? null;
    setCached(cacheKey, result);
    return result;
  });
}
