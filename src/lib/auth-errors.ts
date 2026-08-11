/**
 * Supabase Auth returns its error messages in English with a machine-readable
 * `code` (AuthApiError). Translating the common ones to clear Kreyòl gives
 * users an actionable message instead of raw English (or Supabase's generic
 * "Invalid login credentials" for what's actually an unconfirmed email).
 */

// Statuses @supabase/auth-js itself treats as "retryable network/infra
// errors" (its own NETWORK_ERROR_CODES list —
// node_modules/@supabase/auth-js/dist/main/lib/fetch.js). For exactly these,
// the SDK never reads the real JSON error body (handleError()'s
// NETWORK_ERROR_CODES branch returns before any `await error.json()`), so
// `.message` ends up being `JSON.stringify()` of the raw, unread fetch
// `Response` object — which is always the literal string "{}" (a `Response`
// has no useful own-enumerable properties). Detecting this by status/name is
// more robust than pattern-matching the resulting "{}" string, and also
// catches any other unreadable body the SDK might produce for the same
// class of failure in the future (docs/REGISTRATION_DRIVER_RESTAURANT_AUDIT.md
// — root cause of every signup showing a literal "{}" toast while Supabase
// Auth couldn't send the confirmation email).
const RETRYABLE_STATUS_CODES = new Set([
  500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530,
]);

function isRetryableInfraError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; status?: number };
  if (e.name === "AuthRetryableFetchError") return true;
  return typeof e.status === "number" && RETRYABLE_STATUS_CODES.has(e.status);
}

// A message is only "exploitable" if it's real, human-meaningful text — not
// one of the placeholder strings JS/JSON leaves behind when something failed
// to serialize an error properly: an empty/foreign object stringified via
// JSON.stringify ("{}", "[]"), or the default String() coercion of a bare
// object, `null`, or `undefined`. A user must never see any of these
// literally (docs/REGISTRATION_AUTH_REMEDIATION_REPORT.md, Phase 8-9).
const UNEXPLOITABLE_MESSAGES = new Set(["{}", "[]", "[object Object]", "null", "undefined"]);

function isExploitableMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && !UNEXPLOITABLE_MESSAGES.has(trimmed);
}

const GENERIC_FALLBACK_MESSAGE = "Nou pa kapab trete demann lan kounye a. Tanpri eseye ankò pita.";

export function translateAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case "email_not_confirmed":
      return "Ou poko konfime imèl ou. Verifye bwat imèl ou (ak spam), oswa mande yon nouvo imèl konfimasyon.";
    case "invalid_credentials":
      return "Imèl la oswa modpas la pa kòrèk.";
    case "user_already_exists":
    case "email_exists":
      return "Yon kont deja egziste ak imèl sa a. Eseye konekte oswa reyinisyalize modpas ou.";
    case "weak_password":
      return "Modpas la twò fèb. Itilize omwen 6 karaktè.";
    case "over_email_send_rate_limit":
      return "Twòp imèl mande nan yon ti tan. Tann kèk minit epi eseye ankò.";
    case "over_request_rate_limit":
      return "Twòp esè. Tann kèk minit epi eseye ankò.";
    case "user_not_found":
      return "Nou pa jwenn okenn kont ak imèl sa a.";
    case "same_password":
      return "Nouvo modpas la dwe diferan de ansyen an.";
    case "signup_disabled":
      return "Enskripsyon fèmen kounye a. Kontakte sipò.";
  }

  // Fall back to matching the raw English text for older SDK versions / edge
  // cases that don't set `code`.
  const lower = message.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return "Ou poko konfime imèl ou. Verifye bwat imèl ou (ak spam), oswa mande yon nouvo imèl konfimasyon.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Imèl la oswa modpas la pa kòrèk.";
  }
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "Yon kont deja egziste ak imèl sa a. Eseye konekte oswa reyinisyalize modpas ou.";
  }
  if (lower.includes("rate limit")) {
    return "Twòp esè nan yon ti tan. Tann kèk minit epi eseye ankò.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Pwoblèm koneksyon rezo. Verifye entènèt ou epi eseye ankò.";
  }

  // Last resort: infra-level failures (5xx from Supabase Auth itself — e.g.
  // the confirmation-email mailer being down) and anything else that didn't
  // leave behind a real message. Checked last so it never overrides a
  // legitimately specific match above.
  if (isRetryableInfraError(error) || !isExploitableMessage(message)) {
    return GENERIC_FALLBACK_MESSAGE;
  }
  return message;
}

/** True when the login failure is specifically an unconfirmed email — used to offer a "resend" action. */
export function isEmailNotConfirmedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "email_not_confirmed") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("email not confirmed");
}
