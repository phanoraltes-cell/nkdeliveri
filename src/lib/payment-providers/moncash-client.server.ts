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
 */
import { getMonCashConfig } from "./moncash-config.server";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export class MonCashApiError extends Error {
  readonly httpStatus?: number;
  readonly raw?: unknown;

  constructor(message: string, httpStatus?: number, raw?: unknown) {
    super(message);
    this.name = "MonCashApiError";
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Timeout (AbortController, `DEFAULT_TIMEOUT_MS`) + retry (up to
 * `MAX_ATTEMPTS`, exponential backoff) wrapper around `fetch`. Retries
 * only network errors, timeouts, HTTP 429, and HTTP 5xx — never a 4xx,
 * since that's MonCash telling us the request itself was rejected
 * (bad credentials, bad params, duplicate orderId) and resending it
 * unchanged would just fail again.
 */
async function requestWithRetry(
  url: string,
  init: RequestInit,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = MAX_ATTEMPTS } = {},
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new MonCashApiError(
        isAbort
          ? `MonCash pa reponn apre ${timeoutMs}ms (${attempt} eseye)`
          : `Erè rezo pandan apèl MonCash la: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      );
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

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | undefined;
let pendingTokenRequest: Promise<string> | undefined;

async function requestAccessToken(): Promise<string> {
  const { apiUrl, clientId, clientSecret } = getMonCashConfig();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await requestWithRetry(`${apiUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials&scope=read,write",
  });

  if (!response.ok) {
    throw new MonCashApiError(
      `Otantifikasyon MonCash echwe (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
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

  const response = await requestWithRetry(`${apiUrl}/v1/CreatePayment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ amount: amountHtg, orderId }),
  });

  if (!response.ok) {
    throw new MonCashApiError(
      `MonCash CreatePayment echwe (HTTP ${response.status}) pou orderId=${orderId}`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await response.json()) as {
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

async function retrieveBy(
  path: string,
  body: Record<string, string>,
): Promise<MonCashTransaction | null> {
  const { apiUrl } = getMonCashConfig();
  const token = await getAccessToken();

  const response = await requestWithRetry(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MonCashApiError(
      `MonCash ${path} echwe (HTTP ${response.status})`,
      response.status,
      await safeReadBody(response),
    );
  }

  const data = (await response.json()) as { transaction?: Record<string, unknown> };
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
