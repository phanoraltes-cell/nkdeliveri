/**
 * TACH 2 (ASISTAN AI ADMIN) — dezyèm kouch defans anvan NENPÒT done rive
 * bay API Claude a. Menm si RPC agregasyon yo (get_admin_ai_traffic_stats_secure/
 * get_admin_priorities_secure, migrasyon 20260830160000) DEJA retounen
 * sèlman chif/non biznis (jamè yon liy pou-kliyan), fonksyon sa a rete la
 * kòm garanti defans-an-pwofondè: si yon jou yon nouvo chan sansib ta rive
 * antre nan yon objè ki pase pa isit la (erè pwogramè, chanjman RPC
 * kap vini), li retire OTOMATIKMAN anvan l ka soti bay yon sèvis ekstèn.
 *
 * De kouch:
 *   1. Retire nenpòt KLE ki sanble ak yon chan sansib (non/kontak/adrès/id
 *      moun/idantifyan sekrè), kèlkeswa valè li.
 *   2. Nan VALÈ tèks yo (menm anba yon kle ki pa sansib), ranplase tout
 *      tèks ki sanble ak yon imèl oswa yon nimewo telefòn ak yon
 *      plasholdè — pou kouvri ka yon deskripsyon lib ki ta kontni yon
 *      kontak kole ladan pa erè.
 */

const FORBIDDEN_KEY_PATTERN =
  /email|e-?mail|phone|tel(?:efòn)?|address|adr[eè]s|first[_-]?name|last[_-]?name|full[_-]?name|pr[eé]non|surname|customer_id|reporter_id|owner_id|user_id|driver_id|contact|password|token|secret|api[_-]?key|ssn|passport/i;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Nimewo Ayisyen (8 chif, ak/san "+509"/"509") oswa nenpòt sekans 8+ chif
// konsekitif (ak espas/tirè opsyonèl) — pi laj espre pou kouvri lòt fòma.
const PHONE_PATTERN = /(?:\+?509[\s.-]?)?\d[\d\s.-]{6,}\d/g;

function redactStringPii(value: string): string {
  return value.replace(EMAIL_PATTERN, "[imèl retire]").replace(PHONE_PATTERN, "[telefòn retire]");
}

const MAX_DEPTH = 8;

/**
 * Netwaye yon valè (anvan l voye bay Claude) — retire chan ak kle sansib,
 * epi redije imèl/telefòn ki ta rete nan tèks lib. Retounen yon KOPI, pa
 * modifye `value` orijinal la. `depth` se yon limit anti-rekursyon enfini
 * (yon objè sikilè/twò fon), pa yon paramèt pou apèlan an bay.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactStringPii(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
      out[key] = sanitize(source[key], depth + 1);
    }
    return out;
  }

  // Fonksyon, Symbol, elatriye — pa gen rezon pou sa ta janm rive nan done
  // ki soti nan yon RPC Supabase (JSON pur), men si li rive, pa kite l pase.
  return null;
}

/** Rakoursi pratik pou wout API la: sanitize + re-sérialize an JSON string, pare pou mete nan yon mesaj itilizatè. */
export function sanitizeToJson(value: unknown): string {
  return JSON.stringify(sanitize(value));
}
