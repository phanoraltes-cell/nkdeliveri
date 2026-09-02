/**
 * Low-level HTTP client for PLOP's "Paiement Marchand" (Collect) API
 * (https://plopplop.solutionip.app/paiement-doc) — see
 * docs/archive/plop/PLOP_PHASE0_AUDIT.md for the full endpoint audit this file is
 * built strictly against. Collect (create/verify) AND Withdrawal
 * (auth/withdrawal-token/withdraw/verify) are both implemented here —
 * PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE), Tach 3: the
 * Withdrawal API was previously deliberately out of scope
 * (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 8) pending explicit owner
 * validation for a separate chantier — Altes has now given that
 * validation ("Konekte API retrè PLOP la").
 *
 * HONESTY NOTE on the Withdrawal functions below: the audit (§ 5-8)
 * documents the 3-step flow, the HMAC formula, and the error codes with
 * certainty (PLOP's own doc page). It does NOT capture a full example
 * JSON response body for these endpoints the way it does for Collect
 * (§ 7) — the exact success/error response shape here is inferred from
 * PLOP's own Collect convention (`{status: boolean, message: string,
 * ...}`) plus the documented `error_code` field for withdrawal errors
 * (§ 8, § 14), not copy-pasted from a confirmed real payload. Every
 * response is parsed defensively (never assumes a field exists) and an
 * unrecognized shape is surfaced as a `PlopApiError`, never guessed as
 * success — same posture as `trans_status` above. The FIRST real call
 * this code ever makes is effectively the final verification of this
 * assumption; there is no PLOP sandbox (§ 14.3).
 *
 * IMPORTANT — unlike MonCash's Business API (moncash-client.server.ts),
 * PLOP's Collect endpoints require no OAuth token, no signature, no
 * Authorization header at all: `client_id` in the JSON body is the only
 * credential (see docs/archive/plop/PLOP_PHASE0_AUDIT.md § 6/§ 11, flagged there as a
 * real security gap on PLOP's side, not something this client can
 * compensate for). There is therefore no token cache/refresh logic here,
 * unlike moncash-client.server.ts's `getAccessToken()`.
 *
 * `.server.ts` is load-bearing: the build fails if a route file or
 * component imports this module, which is what keeps `client_id`/
 * `client_secret` out of the browser bundle by construction — the same
 * "never call the provider from a React component" rule
 * moncash-client.server.ts enforces.
 *
 * Every attempt (including retries) is journaled to `plop_api_logs` —
 * schema matrix-matched field-for-field to `moncash_api_logs` (see
 * docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 10), append-only at the database
 * level. Logging is always best-effort: a logging failure must never
 * break a real payment flow, so it only ever warns, never throws.
 */
import { createHmac } from "node:crypto";
import type { Json } from "@/integrations/supabase/types";
import { getPlopConfig, PLOP_BASE_URL } from "./plop-config.server";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

export class PlopApiError extends Error {
  readonly httpStatus?: number;
  readonly raw?: unknown;
  /** Set only for a request that never got a response in time. */
  readonly code?: "timeout";

  constructor(message: string, httpStatus?: number, raw?: unknown, code?: "timeout") {
    super(message);
    this.name = "PlopApiError";
    this.httpStatus = httpStatus;
    this.raw = raw;
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PLOP documents 429 ("Too many requests") and 503 ("Erreur interne") as
 * the only server-side codes for the Payment API (docs/archive/plop/PLOP_PHASE0_AUDIT.md
 * § 5) — 400/404/405 are all client-error rejections that resending
 * unchanged would only repeat. The general 5xx range is kept as a safety
 * net (same convention as moncash-client.server.ts) since no exhaustive
 * error catalogue is documented (§ 14.4).
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

type ApiLogContext = {
  endpoint: string;
  method: string;
  requestSummary: Record<string, unknown>;
  transactionReference?: string | null;
  summarizeResponse?: (body: unknown) => Record<string, unknown>;
  extractProviderTransactionId?: (body: unknown) => string | null;
};

async function writeApiLog(entry: {
  endpoint: string;
  method: string;
  attempt: number;
  httpStatus: number | null;
  durationMs: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown> | null;
  error: string | null;
  isTimeout: boolean;
  transactionReference: string | null;
  providerTransactionId: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("plop_api_logs").insert({
      endpoint: entry.endpoint,
      method: entry.method,
      attempt: entry.attempt,
      http_status: entry.httpStatus,
      duration_ms: entry.durationMs,
      request_summary: entry.requestSummary as Json,
      response_summary: entry.responseSummary as Json | null,
      error: entry.error,
      is_timeout: entry.isTimeout,
      transaction_reference: entry.transactionReference,
      provider_transaction_id: entry.providerTransactionId,
    });
    if (error) console.warn("[plop] failed to write API audit log", error.message);
  } catch (err) {
    console.warn("[plop] failed to write API audit log", err);
  }
}

async function logAttempt(
  ctx: ApiLogContext,
  attempt: number,
  durationMs: number,
  outcome: { response: Response | null; error: string | null; isTimeout: boolean },
): Promise<void> {
  let responseSummary: Record<string, unknown> | null = null;
  let providerTransactionId: string | null = null;
  if (outcome.response) {
    try {
      const body: unknown = await outcome.response.clone().json();
      responseSummary = ctx.summarizeResponse ? ctx.summarizeResponse(body) : null;
      providerTransactionId = ctx.extractProviderTransactionId
        ? ctx.extractProviderTransactionId(body)
        : null;
    } catch {
      // Non-JSON body — nothing more to summarize, HTTP-level facts still logged.
    }
  }
  await writeApiLog({
    endpoint: ctx.endpoint,
    method: ctx.method,
    attempt,
    httpStatus: outcome.response?.status ?? null,
    durationMs,
    requestSummary: ctx.requestSummary,
    responseSummary,
    error: outcome.error,
    isTimeout: outcome.isTimeout,
    transactionReference: ctx.transactionReference ?? null,
    providerTransactionId,
  });
}

/**
 * Timeout (AbortController) + retry (exponential backoff) wrapper around
 * `fetch` — same shape as moncash-client.server.ts's own
 * `requestWithRetry`, deliberately not shared/extracted: PLOP's retry
 * policy (§ above) is its own documented contract, not guaranteed to stay
 * identical to MonCash's if either changes independently.
 */
async function requestWithRetry(
  url: string,
  init: RequestInit,
  logCtx: ApiLogContext,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = MAX_ATTEMPTS } = {},
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const durationMs = Date.now() - startedAt;
      const willRetry = isRetryableStatus(response.status) && attempt < maxAttempts;
      await logAttempt(logCtx, attempt, durationMs, {
        response,
        error: response.ok ? null : `HTTP ${response.status}`,
        isTimeout: false,
      });
      if (willRetry) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const isAbort = err instanceof Error && err.name === "AbortError";
      const message = isAbort
        ? `PLOP pa reponn apre ${timeoutMs}ms (${attempt} eseye)`
        : `Erè rezo pandan apèl PLOP la: ${err instanceof Error ? err.message : String(err)}`;
      await logAttempt(logCtx, attempt, durationMs, {
        response: null,
        error: message,
        isTimeout: isAbort,
      });
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new PlopApiError(message, undefined, err, isAbort ? "timeout" : undefined);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  // Unreachable (the loop above always returns or throws on its last
  // iteration) — satisfies the compiler's control-flow analysis.
  throw new PlopApiError("Eta enkonsistan nan kliyan PLOP la");
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

/**
 * A 2xx response with a body that isn't valid JSON (or is empty) must
 * still surface as a clean PlopApiError, never a raw SyntaxError escaping
 * this module — same gap MonCash's client was hardened against once
 * already (see docs/archive/moncash/MONCASH_RESILIENCE_REPORT.md); guarded against here
 * from the start rather than reproducing it.
 *
 * Reads the body as text exactly once, then attempts `JSON.parse` on the
 * captured text — deliberately NOT `response.json()` followed by
 * `safeReadBody(response)` on failure (the bug this replaces, found by
 * direct testing during docs/archive/plop/PLOP_CLIENT_REMEDIATION_REPORT.md): once a
 * Response's body has been read (even by a call that throws, like an
 * invalid-JSON parse), the Fetch spec marks it "disturbed" and any later
 * read of that same Response — including `.clone()` — silently produces
 * nothing. `safeReadBody`'s own defensive try/catch never threw, so this
 * never crashed, but `PlopApiError.raw` was always `undefined` for a
 * malformed or empty body — exactly the two cases where the raw evidence
 * matters most (logging/debugging what PLOP actually sent). Reading once,
 * up front, means the raw text is always available for `.raw`, whether or
 * not it turns out to be valid JSON.
 */
async function parseJsonOrThrow(response: Response, context: string): Promise<unknown> {
  const rawText = await response.text();
  try {
    return JSON.parse(rawText);
  } catch {
    throw new PlopApiError(
      `Repons PLOP pa nan fòma JSON ki atann pou ${context} (HTTP ${response.status})`,
      response.status,
      rawText,
    );
  }
}

/** First/last 4 chars only — enough to visually correlate log rows without keeping a usable credential at rest. Applied to `client_id`, which (unlike MonCash) is the *only* credential PLOP's Collect API asks for (§ header comment) — treated with the same care as a token even though PLOP itself does not. */
function redactId(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export type PlopCreatePaymentResult = {
  redirectUrl: string;
  providerTransactionId: string | null;
  /** Echoes back exactly what was sent to PLOP for this call — `payment_method_requested` traceability (docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 7 Option A), not PLOP's own response (it doesn't echo this field). */
  paymentMethodRequested: PlopPaymentMethod;
};

/**
 * The 4 values PLOP documents for `payment_method` on `paiement-marchand`
 * (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 7) — `"all"` lets the customer choose on
 * PLOP's own hosted page rather than pre-selecting a wallet. Never
 * expanded on guesswork; if PLOP ever documents a 5th value, add it here
 * explicitly, never accept an unrecognized string silently.
 */
const VALID_PAYMENT_METHODS = ["moncash", "kashpaw", "natcash", "all"] as const;
export type PlopPaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];

/** Exported so callers (plop-provider.server.ts) can reject an unrecognized wallet *before* attempting a call, rather than parsing a thrown PlopApiError's message string to tell "invalid input" apart from "PLOP rejected it" — same list, one source of truth. */
export function isValidPaymentMethod(value: string): value is PlopPaymentMethod {
  return (VALID_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Creates a PLOP Collect payment for `reference` (our own
 * `refference_id` — see InitiatePaymentInput.reference). PLOP requires
 * this value to be new; unlike MonCash's `orderId`, PLOP does not
 * document what happens on reuse (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 14.7) — no
 * idempotent-reconciliation-on-error is attempted here (there is nothing
 * confirmed to reconcile against), a failure is reported honestly and the
 * reconciliation cron (plop-reconcile.server.ts) is the only thing that
 * later re-checks via `verifyPayment`.
 *
 * `paymentMethod` is optional and per-call — falls back to
 * `PLOP_PAYMENT_METHOD`'s configured default only when the caller doesn't
 * specify one, never the other way around (docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md
 * § 2/§ 6: the previous version read the config value unconditionally,
 * making per-transaction wallet selection structurally impossible — this
 * is the fix). Validated against PLOP's documented value set *before* any
 * network call — never send an unrecognized string and let PLOP's own
 * error handling (undocumented for this endpoint, Phase 0 § 14.4) decide
 * what happens.
 */
export async function createPayment(
  reference: string,
  amountHtg: number,
  paymentMethod?: string,
): Promise<PlopCreatePaymentResult> {
  const { clientId, paymentMethod: defaultPaymentMethod } = getPlopConfig();
  const requestedMethod = paymentMethod ?? defaultPaymentMethod;
  if (!isValidPaymentMethod(requestedMethod)) {
    throw new PlopApiError(
      `Metòd peman "${requestedMethod}" pa yon valè PLOP rekonèt (moncash|kashpaw|natcash|all)`,
    );
  }

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/paiement-marchand`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        refference_id: reference,
        montant: amountHtg,
        payment_method: requestedMethod,
      }),
    },
    {
      endpoint: "/api/paiement-marchand",
      method: "POST",
      requestSummary: {
        client_id: redactId(clientId),
        refference_id: reference,
        montant: amountHtg,
        payment_method: requestedMethod,
      },
      transactionReference: reference,
      summarizeResponse: (body) => {
        const b = body as {
          status?: boolean;
          message?: string;
          url?: string;
          transaction_id?: string;
        };
        return {
          status: b.status ?? null,
          message: b.message ?? null,
          has_url: Boolean(b.url),
          transaction_id: b.transaction_id ?? null,
        };
      },
      extractProviderTransactionId: (body) => {
        const b = body as { transaction_id?: string };
        return typeof b.transaction_id === "string" ? b.transaction_id : null;
      },
    },
  );

  if (!response.ok) {
    throw new PlopApiError(
      `PLOP paiement-marchand echwe (HTTP ${response.status}) pou reference=${reference}`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "paiement-marchand")) as {
    status?: boolean;
    url?: string;
    transaction_id?: string;
    message?: string;
  };
  if (!data.status || !data.url) {
    throw new PlopApiError(
      `Repons paiement-marchand PLOP la pa gen ni siksè ni lyen redireksyon (${data.message ?? "san mesaj"})`,
      response.status,
      data,
    );
  }

  return {
    redirectUrl: data.url,
    providerTransactionId: typeof data.transaction_id === "string" ? data.transaction_id : null,
    paymentMethodRequested: requestedMethod,
  };
}

/**
 * PLOP only documents two `trans_status` values ("no"/"ok") — anything
 * else must be reported honestly as `"unknown"`, never guessed as either
 * outcome (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 14.6).
 */
export type PlopTransStatus = "no" | "ok" | "unknown";

export type PlopVerifyResult = {
  transStatus: PlopTransStatus;
  providerTransactionId: string | null;
  amount: number | null;
  /**
   * PLOP's own `method` field on `paiement-verify` — which wallet the
   * customer actually used, as opposed to what we requested at creation
   * (relevant when `payment_method:"all"` was sent, letting the customer
   * pick on PLOP's page — docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md § 4.3,
   * a gap this fixes: previously present only inside `raw`, never
   * surfaced as a typed field).
   */
  walletUsed: string | null;
  raw: unknown;
};

/** Look up a Collect payment by our own `refference_id` — the only lookup key PLOP's verify endpoint documents. */
export async function verifyPayment(reference: string): Promise<PlopVerifyResult> {
  const { clientId } = getPlopConfig();

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/paiement-verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, refference_id: reference }),
    },
    {
      endpoint: "/api/paiement-verify",
      method: "POST",
      requestSummary: { client_id: redactId(clientId), refference_id: reference },
      transactionReference: reference,
      summarizeResponse: (body) => {
        const b = body as {
          status?: boolean;
          message?: string;
          trans_status?: string;
          id_transaction?: string;
          montant?: number;
          method?: string;
        };
        return {
          status: b.status ?? null,
          message: b.message ?? null,
          trans_status: b.trans_status ?? null,
          id_transaction: b.id_transaction ?? null,
          montant: b.montant ?? null,
          method: b.method ?? null,
        };
      },
      extractProviderTransactionId: (body) => {
        const b = body as { id_transaction?: string };
        return typeof b.id_transaction === "string" ? b.id_transaction : null;
      },
    },
  );

  if (!response.ok) {
    throw new PlopApiError(
      `PLOP paiement-verify echwe (HTTP ${response.status}) pou reference=${reference}`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "paiement-verify")) as {
    status?: boolean;
    message?: string;
    trans_status?: string;
    id_transaction?: string;
    montant?: number;
    method?: string;
  };
  if (!data.status) {
    throw new PlopApiError(
      `Repons paiement-verify PLOP la endike echèk (${data.message ?? "san mesaj"})`,
      response.status,
      data,
    );
  }

  const transStatus: PlopTransStatus =
    data.trans_status === "ok" ? "ok" : data.trans_status === "no" ? "no" : "unknown";

  return {
    transStatus,
    providerTransactionId: typeof data.id_transaction === "string" ? data.id_transaction : null,
    amount: typeof data.montant === "number" ? data.montant : null,
    walletUsed: typeof data.method === "string" ? data.method : null,
    raw: data,
  };
}

// =============================================================================
// Withdrawal API (Tach 3, PROMPT MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) —
// 3-step HMAC-signed flow, docs/archive/plop/PLOP_PHASE0_AUDIT.md § 5-8.

/** PLOP's documented withdrawal error codes (§ 8) — surfaced as-is on `PlopApiError.raw`/message rather than re-interpreted, so an admin reading a failure sees PLOP's own vocabulary. */
export type PlopWithdrawalErrorCode =
  | "INVALID_SIGNATURE"
  | "TIMESTAMP_EXPIRED"
  | "NO_CLIENT_SECRET"
  | "INVALID_TOKEN_TYPE"
  | "PARAMETER_MISMATCH"
  | "TOKEN_ALREADY_USED"
  | "WITHDRAWAL_COOLDOWN"
  | "METHOD_NOT_CONFIGURED"
  | "INSUFFICIENT_BALANCE"
  | "API_TRANSFER_FAILED"
  | "DUPLICATE_REFERENCE";

export type PlopWithdrawParams = {
  amount: number;
  /** moncash | kashpaw | natcash — same value set as Collect's payment_method (§ 7), reused here since the audit doesn't document a distinct list for Withdrawal. */
  method: string;
  /** Beneficiary's mobile money number, receiving the funds. */
  recipient: string;
  /** Our own reference — must be new (§ 8, "reference inédite" sinon 409 DUPLICATE_REFERENCE). */
  reference: string;
};

/**
 * Step 1 — `POST /api/auth/marchand`. Deliberately NOT cached/reused
 * across calls: § 14.2 flags an unresolved contradiction in PLOP's own
 * doc about `marchand_token`'s lifetime ("~1 minute" vs `expires_in: 300`
 * in the example) — re-authenticating fresh for every withdrawal
 * operation sidesteps that ambiguity entirely rather than risking a
 * stale token mid-flow. Withdrawal volume is low (payouts, not customer
 * checkout), so the extra round-trip is a non-issue.
 */
async function authenticateMarchand(): Promise<string> {
  const { clientId, clientSecret } = getPlopConfig();

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/auth/marchand`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    },
    {
      endpoint: "/api/auth/marchand",
      method: "POST",
      requestSummary: { client_id: redactId(clientId) },
      summarizeResponse: (body) => {
        const b = body as { status?: boolean; message?: string };
        return { status: b.status ?? null, message: b.message ?? null };
      },
    },
  );

  if (!response.ok) {
    throw new PlopApiError(
      `PLOP auth/marchand echwe (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "auth/marchand")) as {
    status?: boolean;
    marchand_token?: string;
    message?: string;
  };
  if (!data.status || typeof data.marchand_token !== "string" || !data.marchand_token) {
    throw new PlopApiError(
      `Repons auth/marchand PLOP la pa gen okenn marchand_token (${data.message ?? "san mesaj"})`,
      response.status,
      data,
    );
  }
  return data.marchand_token;
}

/**
 * HMAC-SHA256("amount|method|recipient|reference|timestamp", client_secret),
 * hex-encoded — exact field order and pipe-separator per § 6. `amount` is
 * interpolated via String(), same numeric value sent in the request body
 * — not independently confirmed by a worked example in the audit (no
 * such example exists for Withdrawal, § header note above), but the only
 * reading consistent with "paramètres devant être strictement identiques"
 * between step 2 and step 3.
 */
function computeWithdrawalSignature(
  params: PlopWithdrawParams,
  timestamp: number,
  clientSecret: string,
): string {
  const message = `${params.amount}|${params.method}|${params.recipient}|${params.reference}|${timestamp}`;
  return createHmac("sha256", clientSecret).update(message).digest("hex");
}

/** Step 2 — `POST /api/auth/marchand/withdrawal-token`. Returns the scoped, single-use, 120s token plus the exact timestamp used for the signature (step 3 must send the identical value). */
async function getWithdrawalToken(
  marchandToken: string,
  params: PlopWithdrawParams,
): Promise<{ withdrawalToken: string; timestamp: number }> {
  const { clientSecret } = getPlopConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeWithdrawalSignature(params, timestamp, clientSecret);

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/auth/marchand/withdrawal-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${marchandToken}` },
      body: JSON.stringify({
        amount: params.amount,
        method: params.method,
        recipient: params.recipient,
        reference: params.reference,
        timestamp,
        withdrawal_signature: signature,
      }),
    },
    {
      endpoint: "/api/auth/marchand/withdrawal-token",
      method: "POST",
      requestSummary: { reference: params.reference, amount: params.amount, method: params.method },
      transactionReference: params.reference,
      summarizeResponse: (body) => {
        const b = body as { status?: boolean; message?: string; error_code?: string };
        return {
          status: b.status ?? null,
          message: b.message ?? null,
          error_code: b.error_code ?? null,
        };
      },
    },
  );

  const body = await safeReadBody(response);
  if (!response.ok) {
    const b = (body ?? {}) as { message?: string; error_code?: string };
    throw new PlopApiError(
      `PLOP withdrawal-token echwe${b.error_code ? ` (${b.error_code})` : ""} (HTTP ${response.status}) pou reference=${params.reference}: ${b.message ?? "san mesaj"}`,
      response.status,
      body,
    );
  }

  const data = body as { status?: boolean; withdrawal_token?: string; message?: string };
  if (!data.status || typeof data.withdrawal_token !== "string" || !data.withdrawal_token) {
    throw new PlopApiError(
      `Repons withdrawal-token PLOP la pa gen okenn withdrawal_token (${data.message ?? "san mesaj"})`,
      response.status,
      data,
    );
  }
  return { withdrawalToken: data.withdrawal_token, timestamp };
}

export type PlopWithdrawResult = {
  status: "success" | "failed";
  providerTransactionId: string | null;
  errorCode: PlopWithdrawalErrorCode | null;
  message: string | null;
  raw: unknown;
};

/**
 * Executes the full 3-step withdrawal — auth, then withdrawal-token, then
 * the transfer itself. Step 3's body must be byte-for-byte identical to
 * step 2's (§ 6, "paramètres identiques") or PLOP returns
 * 403 PARAMETER_MISMATCH — the same four business fields plus the SAME
 * `timestamp` returned from getWithdrawalToken are reused verbatim, never
 * recomputed.
 *
 * Never throws for a PLOP-side rejection (INSUFFICIENT_BALANCE,
 * METHOD_NOT_CONFIGURED, etc.) — those come back as `status:"failed"`
 * with `errorCode` set, for the caller (plop-provider.server.ts) to map
 * to a clean `InitiatePaymentResult`. Only a network/timeout/malformed-
 * response failure throws `PlopApiError`, exactly like every Collect
 * function above.
 */
export async function executeWithdrawal(params: PlopWithdrawParams): Promise<PlopWithdrawResult> {
  const marchandToken = await authenticateMarchand();
  const { withdrawalToken, timestamp } = await getWithdrawalToken(marchandToken, params);

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/withdraw/marchand`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${withdrawalToken}` },
      body: JSON.stringify({
        amount: params.amount,
        method: params.method,
        recipient: params.recipient,
        reference: params.reference,
        timestamp,
      }),
    },
    {
      endpoint: "/api/withdraw/marchand",
      method: "POST",
      requestSummary: { reference: params.reference, amount: params.amount, method: params.method },
      transactionReference: params.reference,
      summarizeResponse: (body) => {
        const b = body as {
          status?: boolean;
          message?: string;
          error_code?: string;
          transaction_id?: string;
        };
        return {
          status: b.status ?? null,
          message: b.message ?? null,
          error_code: b.error_code ?? null,
          transaction_id: b.transaction_id ?? null,
        };
      },
      extractProviderTransactionId: (body) => {
        const b = body as { transaction_id?: string };
        return typeof b.transaction_id === "string" ? b.transaction_id : null;
      },
    },
    // Withdrawal-token is single-use and expires in 120s (§ 12) — a retry
    // on a transient network error would need a BRAND NEW token (this
    // one would already be consumed or expired), which requestWithRetry
    // cannot do (it retries the same request). One attempt only; a
    // network failure here surfaces as a genuine PlopApiError for the
    // caller to treat as "unknown outcome, needs manual verification" via
    // verifyWithdrawal(), never silently retried against a dead token.
    { maxAttempts: 1 },
  );

  const body = await safeReadBody(response);
  const b = (body ?? {}) as {
    status?: boolean;
    message?: string;
    error_code?: string;
    transaction_id?: string;
  };

  if (!response.ok || !b.status) {
    return {
      status: "failed",
      providerTransactionId: null,
      errorCode: (b.error_code as PlopWithdrawalErrorCode) ?? null,
      message: b.message ?? `HTTP ${response.status}`,
      raw: body,
    };
  }

  return {
    status: "success",
    providerTransactionId: typeof b.transaction_id === "string" ? b.transaction_id : null,
    errorCode: null,
    message: b.message ?? null,
    raw: body,
  };
}

export type PlopWithdrawStatus = "pending" | "failed" | "success" | "refunded" | "unknown";

/** `POST /api/withdraw/marchand/verify` — status lookup by our own `reference`, reusing the `marchand_token` from step 1 (not the withdrawal_token, § 8/§ 6). */
export async function verifyWithdrawal(
  reference: string,
): Promise<{ status: PlopWithdrawStatus; raw: unknown }> {
  const marchandToken = await authenticateMarchand();

  const response = await requestWithRetry(
    `${PLOP_BASE_URL}/api/withdraw/marchand/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${marchandToken}` },
      body: JSON.stringify({ reference }),
    },
    {
      endpoint: "/api/withdraw/marchand/verify",
      method: "POST",
      requestSummary: { reference },
      transactionReference: reference,
      summarizeResponse: (body) => {
        const b = body as { status?: string; message?: string };
        return { status: b.status ?? null, message: b.message ?? null };
      },
    },
  );

  if (!response.ok) {
    throw new PlopApiError(
      `PLOP withdraw/marchand/verify echwe (HTTP ${response.status}) pou reference=${reference}`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "withdraw/marchand/verify")) as {
    status?: string;
  };
  const known: PlopWithdrawStatus[] = ["pending", "failed", "success", "refunded"];
  const status = known.includes(data.status as PlopWithdrawStatus)
    ? (data.status as PlopWithdrawStatus)
    : "unknown";

  return { status, raw: data };
}
