/**
 * Konfigirasyon VAPID pou notifikasyon push — yon sèl kote ki li, VALIDE
 * epi NÒMALIZE anviwònman an.
 *
 * 2 BUG SA A KORIJE:
 *
 * 1) `JSON.parse(process.env.VAPID_PRIVATE_JWK!)` — lè varyab la pa
 *    konfigire, `!` la bay TypeScript manti epi runtime lan voye
 *    `SyntaxError: "undefined" is not valid JSON`. Mesaj sa a te rive
 *    jouk nan ekran itilizatè a lè li klike "Voye yon tès", san li pa di
 *    anyen sou vrè pwoblèm nan.
 *
 * 2) FÒMA KLE A. @block65/webcrypto-web-push konstwi JWK la LI MENM: li
 *    derive `x`/`y` apati VAPID_PUBLIC_KEY epi li mete
 *    `d: vapid.privateKey` (wè dist/lib/vapid.js). Donk li atann yon
 *    CHÈN `d` — pa yon objè JWK konplè. Ansyen kòd la t ap pase objè a
 *    nèt, sa ki ta fè `crypto.subtle.importKey` echwe MENM apre varyab
 *    yo byen konfigire. Fonksyon sa a aksepte tou de fòma epi li
 *    toujou bay chèn `d` la:
 *      - JSON JWK: {"kty":"EC","crv":"P-256","x":"…","y":"…","d":"…"}
 *      - oswa dirèkteman valè `d` la kòm yon senp chèn base64url
 *        (sa `npx web-push generate-vapid-keys` bay la).
 */
export type VapidConfig = {
  subject: string;
  publicKey: string;
  /** Valè `d` JWK la (base64url) — se sa lib la atann, pa objè JWK la. */
  privateKey: string;
};

export type VapidConfigResult =
  | { configured: true; vapid: VapidConfig }
  | { configured: false; missing: string[]; error: string };

export function getVapidConfig(): VapidConfigResult {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const rawPrivate = process.env.VAPID_PRIVATE_JWK;

  const missing: string[] = [];
  if (!subject) missing.push("VAPID_SUBJECT");
  if (!publicKey) missing.push("VAPID_PUBLIC_KEY");
  if (!rawPrivate) missing.push("VAPID_PRIVATE_JWK");

  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      error: `Notifikasyon push pa konfigire sou sèvè a — varyab ki manke: ${missing.join(", ")}`,
    };
  }

  const trimmed = rawPrivate!.trim();
  let privateKey: string;

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        configured: false,
        missing: ["VAPID_PRIVATE_JWK"],
        error:
          'VAPID_PRIVATE_JWK sanble yon JSON men li malfòme — verifye gilmè yo (egz. {"kty":"EC","crv":"P-256","d":"…"}).',
      };
    }
    const d = (parsed as { d?: unknown } | null)?.d;
    if (typeof d !== "string" || d.length === 0) {
      return {
        configured: false,
        missing: ["VAPID_PRIVATE_JWK"],
        error:
          'VAPID_PRIVATE_JWK se yon JSON valid men li pa gen chan "d" la (kle prive a). Sèvi ak JWK konplè a oswa valè "d" la dirèkteman.',
      };
    }
    privateKey = d;
  } else {
    privateKey = trimmed;
  }

  return { configured: true, vapid: { subject: subject!, publicKey: publicKey!, privateKey } };
}
