/**
 * Low-level HTTP client for MonCash's public Business API
 * (https://moncashbutton.digicelgroup.com/Moncash-business/) — OAuth2
 * client_credentials auth, CreatePayment, RetrieveOrderPayment,
 * RetrieveTransactionPayment. Every request happens here and nowhere
 * else; `moncash-provider.server.ts` is the only caller, and this file
 * is the only one allowed to read the access token.
 *
 * IMPORTANT — this is MonCash's *collection* gateway (a customer pays a
 * merchant through a redirect flow), not a B2C disbursement API. There is
 * no publicly documented MonCash endpoint that sends money to an
 * arbitrary phone number, which is what this app's payout flow needs.
 * `moncash-provider.server.ts` refuses `direction: "disburse"` for
 * exactly this reason — see docs/PAYMENT_PROVIDERS.md.
 *
 * `.server.ts` is load-bearing: the build fails if a route file or
 * component imports this module, which is what keeps the access token —
 * and the client secret used to obtain it — out of the browser by
 * construction, never by convention.
 *
 * Every attempt (including retries) is journaled to `moncash_api_logs` —
 * endpoint, timing, HTTP status, a *sanitized* request/response summary,
 * error, timeout flag, and the MonCash reference when known. That table
 * is append-only at the database level (triggers reject UPDATE/DELETE/
 * TRUNCATE for every role, including service_role) — see
 * docs/MONCASH_FINANCIAL_AUDIT.md and
 * supabase/migrations/20260730130000_moncash_financial_audit_log.sql.
 * Logging is always best-effort: a logging failure must never break a
 * real payment flow, so it only ever warns, never throws.
 */
import type { Json } from "@/integrations/supabase/types";
import { getMonCashConfig } from "./moncash-config.server";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export class MonCashApiError extends Error {
  readonly httpStatus?: number;
  readonly raw?: unknown;
  /** Set only for a request that never got a response in time — lets callers (the admin "timeout" notification) tell this apart from a genuine rejection. */
  readonly code?: "timeout";

  constructor(message: string, httpStatus?: number, raw?: unknown, code?: "timeout") {
    super(message);
    this.name = "MonCashApiError";
    this.httpStatus = httpStatus;
    this.raw = raw;
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * What a caller of requestWithRetry declares as safe to persist —
 * *never* pass a raw header, token, or full unfiltered body here.
 * `summarizeResponse`/`extractProviderTransactionId` receive the parsed
 * JSON body (or `undefined` if it wasn't valid JSON) and must return only
 * fields that are safe to keep in a durable, admin-readable audit log.
 */
type ApiLogContext = {
  endpoint: string;
  requestSummary: Record<string, unknown>;
  transactionReference?: string | null;
  summarizeResponse?: (body: unknown) => Record<string, unknown>;
  extractProviderTransactionId?: (body: unknown) => string | null;
};

async function writeApiLog(entry: {
  endpoint: string;
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
    const { error } = await supabaseAdmin.from("moncash_api_logs").insert({
      endpoint: entry.endpoint,
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
    if (error) console.warn("[moncash] failed to write API audit log", error.message);
  } catch (err) {
    console.warn("[moncash] failed to write API audit log", err);
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
      // Non-JSON body (e.g. an HTML error page from a gateway in front of
      // MonCash) — nothing more to summarize, the HTTP-level facts below
      // are still logged.
    }
  }
  await writeApiLog({
    endpoint: ctx.endpoint,
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
 * Timeout (AbortController, `DEFAULT_TIMEOUT_MS`) + retry (up to
 * `MAX_ATTEMPTS`, exponential backoff) wrapper around `fetch`. Retries
 * only network errors, timeouts, HTTP 429, and HTTP 5xx — never a 4xx,
 * since that's MonCash telling us the request itself was rejected
 * (bad credentials, bad params, duplicate orderId) and resending it
 * unchanged would just fail again. Every individual attempt is journaled
 * via `logCtx`, whether it succeeds, gets retried, or ultimately fails.
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
        ? `MonCash pa reponn apre ${timeoutMs}ms (${attempt} eseye)`
        : `Erè rezo pandan apèl MonCash la: ${err instanceof Error ? err.message : String(err)}`;
      await logAttempt(logCtx, attempt, durationMs, {
        response: null,
        error: message,
        isTimeout: isAbort,
      });
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new MonCashApiError(message, undefined, err, isAbort ? "timeout" : undefined);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  // Unreachable (the loop above always returns or throws on its last
  // iteration) — satisfies the compiler's control-flow analysis.
  throw new MonCashApiError("Eta enkonsistan nan kliyan MonCash la");
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
 * A 2xx response with a body that isn't valid JSON (a proxy/gateway
 * error page, a truncated response, MonCash returning something
 * unexpected) must still surface as a clean MonCashApiError — not a raw
 * SyntaxError from `.json()` propagating past every other error-handling
 * path in this file. Resilience gap closed in the hardening pass (see
 * docs/MONCASH_RESILIENCE_REPORT.md) — response.ok being true is not the
 * same guarantee as "the body is well-formed JSON".
 */
async function parseJsonOrThrow(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MonCashApiError(
      `Repons MonCash pa nan fòma JSON ki atann pou ${context} (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }
}

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | undefined;
let pendingTokenRequest: Promise<string> | undefined;

async function requestAccessToken(): Promise<string> {
  const { apiUrl, clientId, clientSecret } = getMonCashConfig();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await requestWithRetry(
    `${apiUrl}/oauth/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials&scope=read,write",
    },
    {
      endpoint: "/oauth/token",
      // Never log the Authorization header (contains the client secret,
      // base64-encoded but not encrypted) or the response's access_token.
      requestSummary: { grant_type: "client_credentials", scope: "read,write" },
      summarizeResponse: (body) => {
        const b = body as { access_token?: string; expires_in?: number; token_type?: string };
        return {
          has_access_token: Boolean(b.access_token),
          expires_in: b.expires_in ?? null,
          token_type: b.token_type ?? null,
        };
      },
    },
  );

  if (!response.ok) {
    throw new MonCashApiError(
      `Otantifikasyon MonCash echwe (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "oauth/token")) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new MonCashApiError(
      "Repons otantifikasyon MonCash la pa gen access_token",
      response.status,
      data,
    );
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - TOKEN_SAFETY_MARGIN_MS,
  };
  return cachedToken.accessToken;
}

/**
 * Returns a cached, still-valid access token, or fetches a fresh one.
 * Concurrent callers during a cold cache share one in-flight request
 * (never fire N parallel token requests for N simultaneous payouts).
 * The token itself never leaves this module except as a Bearer header
 * on the very next request.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  if (!pendingTokenRequest) {
    pendingTokenRequest = requestAccessToken().finally(() => {
      pendingTokenRequest = undefined;
    });
  }
  return pendingTokenRequest;
}

function gatewayRootFromApiUrl(apiUrl: string): string {
  // MonCash's documented API base ends in `/Api`
  // (e.g. https://sandbox.moncashbutton.digicelgroup.com/Api); the
  // customer-facing redirect page lives one level up, under
  // /Moncash-middleware. If MONCASH_API_URL doesn't follow that
  // convention, this falls back to appending onto the URL as given —
  // verify the resulting link manually against MonCash's own docs
  // before relying on it in production.
  return apiUrl.replace(/\/api\/?$/i, "");
}

export function buildMonCashRedirectUrl(paymentToken: string): string {
  const { apiUrl } = getMonCashConfig();
  const root = gatewayRootFromApiUrl(apiUrl);
  return `${root}/Moncash-middleware/Payment/Redirect?token=${encodeURIComponent(paymentToken)}`;
}

export type MonCashCreatePaymentResult = {
  paymentToken: string;
  redirectUrl: string;
  expiresAt: string | null;
};

/** First/last 4 chars only — enough to visually correlate log rows without keeping a usable token at rest. */
function redactToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.length <= 10) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Creates a MonCash collection payment for `orderId` (our own reference —
 * see InitiatePaymentInput.reference). MonCash requires `orderId` to be
 * unique per merchant and rejects a second CreatePayment for one already
 * in use; that uniqueness constraint *is* this API's idempotency
 * mechanism (it has no Idempotency-Key header), so retrying this call
 * with the same orderId after a timeout is always safe — the caller
 * (moncash-provider.server.ts) reconciles via `retrieveOrderPayment`
 * rather than assuming a thrown error means nothing happened.
 */
export async function createPayment(
  orderId: string,
  amountHtg: number,
): Promise<MonCashCreatePaymentResult> {
  const { apiUrl } = getMonCashConfig();
  const token = await getAccessToken();

  const response = await requestWithRetry(
    `${apiUrl}/v1/CreatePayment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ amount: amountHtg, orderId }),
    },
    {
      endpoint: "/v1/CreatePayment",
      requestSummary: { orderId, amount: amountHtg },
      transactionReference: orderId,
      summarizeResponse: (body) => {
        const b = body as {
          payment_token?: { token?: string; expired?: string };
          message?: string;
        };
        return {
          payment_token: redactToken(b.payment_token?.token),
          expires_at: b.payment_token?.expired ?? null,
          message: b.message ?? null,
        };
      },
    },
  );

  if (!response.ok) {
    throw new MonCashApiError(
      `MonCash CreatePayment echwe (HTTP ${response.status}) pou orderId=${orderId}`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, "CreatePayment")) as {
    payment_token?: { token?: string; created?: string; expired?: string };
  };
  const paymentToken = data.payment_token?.token;
  if (!paymentToken) {
    throw new MonCashApiError(
      "Repons CreatePayment MonCash la pa gen payment_token",
      response.status,
      data,
    );
  }

  return {
    paymentToken,
    redirectUrl: buildMonCashRedirectUrl(paymentToken),
    expiresAt: data.payment_token?.expired ?? null,
  };
}

export type MonCashTransactionStatus = "successful" | "failed" | "unknown";

export type MonCashTransaction = {
  transactionId: string;
  orderId: string | null;
  status: MonCashTransactionStatus;
  amount: number | null;
  message: string | null;
  raw: unknown;
};

function normalizeStatus(payload: Record<string, unknown>): MonCashTransactionStatus {
  const message = String(payload.message ?? "").toLowerCase();
  if (message.includes("success")) return "successful";
  if (message.includes("fail") || message.includes("expir") || message.includes("cancel")) {
    return "failed";
  }
  return "unknown";
}

function extractTransactionId(tx: Record<string, unknown> | undefined): string | null {
  if (!tx) return null;
  const id = tx.transaction_id ?? tx.reference;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function retrieveBy(
  path: string,
  body: Record<string, string>,
): Promise<MonCashTransaction | null> {
  const { apiUrl } = getMonCashConfig();
  const token = await getAccessToken();

  const response = await requestWithRetry(
    `${apiUrl}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      endpoint: path,
      requestSummary: body,
      transactionReference: body.orderId ?? null,
      summarizeResponse: (respBody) => {
        const b = respBody as { transaction?: Record<string, unknown>; message?: string };
        return b.transaction
          ? {
              transaction_id: b.transaction.transaction_id ?? null,
              order_id: b.transaction.order_id ?? null,
              status_message: b.transaction.message ?? null,
              cost: b.transaction.cost ?? null,
            }
          : { message: b.message ?? null };
      },
      extractProviderTransactionId: (respBody) => {
        const b = respBody as { transaction?: Record<string, unknown> };
        return extractTransactionId(b.transaction);
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MonCashApiError(
      `MonCash ${path} echwe (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await parseJsonOrThrow(response, path)) as {
    transaction?: Record<string, unknown>;
  };
  const tx = data.transaction;
  if (!tx) return null;

  return {
    transactionId: String(tx.transaction_id ?? tx.reference ?? ""),
    orderId: typeof tx.order_id === "string" ? tx.order_id : null,
    status: normalizeStatus(tx),
    amount: typeof tx.cost === "number" ? tx.cost : null,
    message: typeof tx.message === "string" ? tx.message : null,
    raw: tx,
  };
}

/** Look up a payment by our own orderId — the primary reconciliation path (see createPayment). */
export async function retrieveOrderPayment(orderId: string): Promise<MonCashTransaction | null> {
  return retrieveBy("/v1/RetrieveOrderPayment", { orderId });
}

/** Look up a payment by MonCash's own transaction id (e.g. from a completed retrieveOrderPayment result). */
export async function retrieveTransactionPayment(
  transactionId: string,
): Promise<MonCashTransaction | null> {
  return retrieveBy("/v1/RetrieveTransactionPayment", { transactionId });
}
