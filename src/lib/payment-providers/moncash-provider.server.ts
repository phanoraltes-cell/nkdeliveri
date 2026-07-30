import type { PaymentProvider } from "./types";
import { isMonCashConfigured } from "./moncash-config.server";
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
const NO_PUBLIC_WEBHOOK =
  "API biznis MonCash la pa dokimante piblikman okenn mekanis webhook pou kounye a — itilize checkStatus() pou verifye eta yon peman.";

function describeError(err: unknown): string {
  if (err instanceof MonCashApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erè MonCash san detay";
}

export const moncashProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => isMonCashConfigured(),

  async initiatePayment(input) {
    if (!isMonCashConfigured()) return { status: "failed", error: NOT_CONFIGURED };
    if (input.direction === "disburse") {
      return { status: "failed", error: DISBURSEMENT_NOT_SUPPORTED };
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
      return { status: "failed", error: describeError(err) };
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

  async verifyWebhook() {
    return { valid: false, error: NO_PUBLIC_WEBHOOK };
  },
};
