/**
 * PostgREST (Supabase table calls) and RPC errors carry a machine-readable
 * Postgres SQLSTATE `code` and a `message` that, for anything other than a
 * deliberate `RAISE EXCEPTION` inside one of this project's `_secure` RPCs,
 * comes straight from the database engine — which can and does name real
 * tables/columns/constraints (e.g. `duplicate key value violates unique
 * constraint "addresses_pkey"`). Left unmapped, that text reaches the user
 * verbatim through the `toast.error(e.message)` pattern used at 70+ call
 * sites across src/routes and src/components (see
 * docs/archive/phases/NKD-003_MIGRATION_BACKLOG.md) — an information-disclosure risk
 * flagged in the Faz 1 architecture audit (NKD-003).
 *
 * This project's established convention for RPC-specific *business* errors
 * is to translate the `RAISE EXCEPTION` text itself, in SQL, at the source
 * (docs/archive/phases/PHASE_1_REMEDIATION_REPORT.md, F-02 — `claim_delivery_secure`'s
 * messages were fixed there, not intercepted here). A custom
 * `RAISE EXCEPTION` without an explicit SQLSTATE always surfaces as
 * Postgres code "P0001", so this function trusts and passes through any
 * "P0001" message unchanged — re-translating it here would fight that
 * existing per-RPC review process instead of complementing it.
 *
 * Every OTHER known Postgres code gets a generic, safe Kreyòl message by
 * category. Unlike translateAuthError() (auth-errors.ts) — whose fallback
 * shows the raw Auth message when it isn't one of a few known JSON-artifact
 * placeholders, because GoTrue's error surface is small and enumerable —
 * any UNKNOWN code here always falls back to the fully generic message.
 * Postgres's raw error surface is open-ended and schema-revealing, so
 * "unknown" must never mean "show it anyway" for this layer specifically.
 *
 * Whenever the real message is hidden from the user (every branch except
 * the P0001 passthrough), it's still logged in full — console.error for
 * local/dev visibility, plus Sentry if configured — so nothing is lost for
 * debugging, only kept out of the UI.
 */

const GENERIC_FALLBACK_MESSAGE = "Nou pa kapab trete demann lan kounye a. Tanpri eseye ankò pita.";

// A custom `RAISE EXCEPTION` inside a PL/pgSQL function without an explicit
// SQLSTATE always surfaces as this code — the convention every `_secure`
// RPC in this project already follows.
const CUSTOM_RPC_EXCEPTION_CODE = "P0001";

// Postgres SQLSTATE codes a client-facing Supabase insert/update/delete/rpc
// call can realistically hit. Extend deliberately (with a real call site as
// justification — see docs/archive/phases/NKD-003_MIGRATION_BACKLOG.md), not defensively:
// an entry here is a promise that the category-level message never leaks a
// table/column/constraint name.
const KNOWN_PG_CODE_MESSAGES: Record<string, string> = {
  "23505": "Done sa a deja egziste.", // unique_violation
  "23503": "Aksyon sa a pa posib paske li lye ak yon lòt enfòmasyon.", // foreign_key_violation
  "23502": "Gen yon enfòmasyon obligatwa ki manke.", // not_null_violation
  "23514": "Valè a pa valid.", // check_violation
  "42501": "Ou pa gen otorizasyon pou fè aksyon sa a.", // insufficient_privilege
  "22P02": "Valè a pa valid.", // invalid_text_representation — real call site: create_order_secure's _idempotency_key (uuid) param, NKD-011
};

// Same lazy-import pattern as src/routes/__root.tsx's ErrorComponent: never
// block the toast on Sentry's chunk, and sentry-browser.ts's own
// `initialized` guard makes repeated calls cheap once it's loaded.
function loadSentry() {
  return import("@/lib/sentry-browser");
}

/** Logs the real error for debugging without ever surfacing it to the UI. */
function logHiddenError(error: unknown) {
  console.error(error);
  void loadSentry().then((m) => m.captureExceptionClient(error));
}

export function translateSupabaseError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const rawMessage =
    error instanceof Error ? error.message : (error as { message?: string } | null)?.message;

  if (
    code === CUSTOM_RPC_EXCEPTION_CODE &&
    typeof rawMessage === "string" &&
    rawMessage.trim().length > 0
  ) {
    return rawMessage;
  }

  logHiddenError(error);

  if (typeof code === "string" && code in KNOWN_PG_CODE_MESSAGES) {
    return KNOWN_PG_CODE_MESSAGES[code];
  }

  return GENERIC_FALLBACK_MESSAGE;
}

// NKD-012 — a real network/connectivity failure (request never reached the
// server, or no response ever came back) must never be shown or retried the
// same way as a normal Postgres/business error. Every error this module
// otherwise handles — including an *unmapped* one — carries a Postgres
// SQLSTATE `code` string, because it came from PostgREST/Postgres actually
// responding. A genuine network failure (the browser's fetch throwing, a
// client-side timeout) has no such code at all: that absence is the same
// signal `translateSupabaseError` above already keys its P0001-passthrough
// decision on, just named and exported here so a caller can decide whether
// to retry *before* translating the error into a shown message. Deliberately
// does NOT consult `navigator.onLine` — it commonly reports `true` in Haiti
// while the request still fails outright (this project's own field
// observation, NKD-012) — the shape of the thrown error is the only honest
// signal available.
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return typeof (error as { code?: string }).code !== "string";
}

/** Shown while an automatic retry (same idempotency key) is still in flight — never an immediate hard failure. */
export const NETWORK_RETRY_MESSAGE = "Koneksyon an fèb. N ap verifye si kòmand ou a pase...";

/** Shown only once every automatic retry has also failed — the order may still have gone through server-side, so this must never claim it didn't. */
export const NETWORK_GIVE_UP_MESSAGE =
  "Nou pa ka konfime si kòmand ou a pase — koneksyon an fèb. Tcheke lis kòmand ou pou wè si li la.";
