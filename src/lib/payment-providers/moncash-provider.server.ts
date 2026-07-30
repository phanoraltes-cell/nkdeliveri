import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, PaymentWebhookEvent } from "./types";
import { isMonCashConfigured, getMonCashConfig } from "./moncash-config.server";
import { MonCashApiError, createPayment, retrieveOrderPayment } from "./moncash-client.server";

// Real MonCash Business API integration (moncash-client.server.ts) —
// OAuth2 client_credentials auth, CreatePayment, RetrieveOrderPayment,
// with timeout + retry + idempotent reconciliation built in. See that
// file and docs/PAYMENT_PROVIDERS.md for the full picture.
//
// IMPORTANT — MonCash's public API is a *collection* gateway (a customer
// pays a merchant through a redirect flow), not a B2C disbursement API:
// no confirmed endpoint exists for sending money to an arbitrary phone
// number, which is what this app's payout flow needs. `initiatePayment`
// therefore explicitly refuses `direction: "disburse"` below rather than
// silently doing nothing or pretending to succeed — see the "Audit
// intégration MonCash" report and docs/PAYMENT_PROVIDERS.md § Ce qui
// n'est PAS fait. `direction: "collect"` (a future checkout gateway) is
// genuinely implemented.
//
// `.server.ts` is load-bearing, not stylistic: it's what keeps
// MONCASH_CLIENT_SECRET/the access token out of the client bundle by
// construction — the build fails if a route file or component ever
// imports this module (or moncash-client.server.ts) directly, the exact
// "never call MonCash from a React component" rule this file exists to
// enforce.
const NOT_CONFIGURED = "MonCash API pa konfigire toujou";
const DISBURSEMENT_NOT_SUPPORTED =
  "API biznis MonCash la se yon pòtay kolekte (kliyan peye machann) — li pa gen okenn pwen final piblik pou voye lajan (disbursement) nan yon nimewo telefòn. Kontra sa a poko konfime ak Digicel.";

function describeError(err: unknown): string {
  if (err instanceof MonCashApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erè MonCash san detay";
}

// MonCash's Business API does not publicly document a webhook mechanism
// (header name, signing algorithm, or payload shape) — everything below
// is the standard, generic convention used by most payment providers
// (HMAC-SHA256 over the raw request body, hex-encoded, in a custom
// signature header), NOT a confirmed MonCash contract. This is written
// so a real webhook is genuinely verifiable and processable the moment
// Digicel confirms the actual scheme — until then, treat the header name
// below as a placeholder to double-check, not a documented fact. See
// docs/MONCASH_WEBHOOK_SECURITY.md.
const SIGNATURE_HEADER = "x-moncash-signature";

function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signatureHeader.trim(), "utf8");
  // timingSafeEqual throws on length mismatch rather than returning
  // false -- check first so a wrong-length header can't ever throw an
  // unhandled error out of the request handler.
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function parseWebhookPayload(rawBody: string): PaymentWebhookEvent | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return undefined;
  }

  const providerReference =
    typeof json.transaction_id === "string"
      ? json.transaction_id
      : typeof json.reference === "string"
        ? json.reference
        : undefined;
  if (!providerReference) return undefined;

  const ourReference =
    typeof json.order_id === "string"
      ? json.order_id
      : typeof json.orderId === "string"
        ? json.orderId
        : null;

  const message = String(json.message ?? json.status ?? "").toLowerCase();
  const status: PaymentWebhookEvent["status"] = message.includes("success")
    ? "success"
    : message.includes("fail") || message.includes("cancel") || message.includes("expir")
      ? "failed"
      : "pending";

  const amount =
    typeof json.amount === "number"
      ? json.amount
      : typeof json.cost === "number"
        ? json.cost
        : undefined;

  return { providerReference, ourReference, status, amount, raw: json };
}

export const moncashProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => isMonCashConfigured(),

  async initiatePayment(input) {
    if (!isMonCashConfigured()) {
      return { status: "failed", error: NOT_CONFIGURED, code: "not_configured" };
    }
    if (input.direction === "disburse") {
      return { status: "failed", error: DISBURSEMENT_NOT_SUPPORTED, code: "unsupported" };
    }

    try {
      const result = await createPayment(input.reference, input.amount);
      return {
        status: "pending",
        providerReference: input.reference,
        raw: {
          paymentToken: result.paymentToken,
          redirectUrl: result.redirectUrl,
          expiresAt: result.expiresAt,
        },
      };
    } catch (err) {
      // Idempotent reconciliation: MonCash's own orderId-uniqueness
      // constraint is its idempotency mechanism (no Idempotency-Key
      // header exists). A network timeout that actually succeeded
      // server-side and a genuine "orderId already used" rejection look
      // identical from here — either way, whatever MonCash now has on
      // file for this orderId is the truth, so check there before
      // reporting failure.
      try {
        const existing = await retrieveOrderPayment(input.reference);
        if (existing?.status === "successful") {
          return {
            status: "success",
            providerReference: existing.transactionId,
            raw: existing.raw,
          };
        }
        if (existing) {
          return { status: "pending", providerReference: input.reference, raw: existing.raw };
        }
      } catch {
        // Reconciliation lookup itself failed — fall through to the original error.
      }
      const code =
        err instanceof MonCashApiError && err.code === "timeout" ? "timeout" : "rejected";
      return { status: "failed", error: describeError(err), code };
    }
  },

  async checkStatus(providerReference) {
    if (!isMonCashConfigured()) return { status: "unknown", error: NOT_CONFIGURED };
    try {
      const tx = await retrieveOrderPayment(providerReference);
      if (!tx)
        return { status: "unknown", error: "Pa gen okenn tranzaksyon MonCash pou referans sa a" };
      if (tx.status === "successful") {
        return { status: "success", providerReference: tx.transactionId, raw: tx.raw };
      }
      if (tx.status === "failed") {
        return { status: "failed", error: tx.message ?? "Peman MonCash echwe", raw: tx.raw };
      }
      return { status: "pending", raw: tx.raw };
    } catch (err) {
      return { status: "unknown", error: describeError(err) };
    }
  },

  async cancelPayment() {
    // MonCash's Business API has no cancel/void endpoint — a created
    // payment token simply expires unused. This is the honest answer,
    // not a failure (mirrors manual-provider.server.ts's own use of
    // "not_cancellable" for a rail that can't support it).
    return { status: "not_cancellable" };
  },

  async verifyWebhook(rawBody, headers) {
    if (!isMonCashConfigured()) return { valid: false, error: NOT_CONFIGURED };

    const { webhookSecret } = getMonCashConfig();
    const signatureHeader = headers[SIGNATURE_HEADER] ?? headers[SIGNATURE_HEADER.toUpperCase()];
    if (!verifySignature(rawBody, signatureHeader, webhookSecret)) {
      return { valid: false, error: "Siyati webhook la envalid oswa absan" };
    }

    const event = parseWebhookPayload(rawBody);
    if (!event) {
      return { valid: false, error: "Peyload webhook la pa nan fòma ki atann" };
    }

    return { valid: true, event };
  },
};
