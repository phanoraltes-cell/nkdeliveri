/**
 * Stripe implementation of `PaymentProvider` (`./types.ts`) — the
 * fournisseur behind the "Kat Kredi" (credit card) checkout method
 * (`payment_provider_settings.provider = 'stripe'`,
 * docs/STRIPE_INTEGRATION_REPORT.md). Collect only, same scope
 * discipline as plopProvider — this app has no card-based payout/
 * disbursement need, so `direction: "disburse"` is refused here exactly
 * like every other collect-only provider in this codebase.
 *
 * Built on Stripe Checkout Sessions (hosted, redirect-based) — same
 * customer-facing shape as the PLOP flow already in production (click,
 * redirect to the provider's own page, come back, confirmed
 * automatically), so it reuses the existing polling infrastructure
 * (useCollectPaymentPoll) and RPCs (create_collect_payment_secure/
 * complete_collect_payment_secure) without either needing a redesign.
 *
 * KEY DIFFERENCE FROM `checkStatus`'s USUAL CONTRACT: every other
 * provider in this codebase (plopProvider, the legacy moncashProvider)
 * takes OUR OWN `external_reference` as `checkStatus`'s argument, because
 * their own APIs accept that reference directly. Stripe's Checkout
 * Session API has no way to look up a session by an arbitrary caller
 * reference after the fact (docs/STRIPE_INTEGRATION_REPORT.md) — only by
 * Stripe's own session id. So for THIS provider, `checkStatus`'s argument
 * must be the Stripe session id (stored as `provider_transaction_id` on
 * the `payment_transactions` row at creation time), not the external
 * reference. Every caller that dispatches between providers
 * (initiate-collect-payment.logic.ts, poll-collect-payment.logic.ts) is
 * responsible for passing the right value to the right provider — never
 * assumed silently, always because the row's own `provider` column says
 * which one this is.
 */
import type { PaymentProvider } from "./types";
import { isStripeConfigured } from "./stripe-config.server";
import {
  StripeApiError,
  createCheckoutSession,
  retrieveCheckoutSessionById,
} from "./stripe-client.server";

const NOT_CONFIGURED = "Peman ak kat kredi pa konfigire toujou";

const DISBURSEMENT_NOT_SUPPORTED =
  "Entegrasyon Stripe sa a sèlman kouvri kolekte (peman kliyan) — pa gen okenn itilizasyon kat kredi pou dekèsman nan aplikasyon sa a.";

function describeError(err: unknown): string {
  if (err instanceof StripeApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erè Stripe san detay";
}

export const stripeProvider: PaymentProvider = {
  code: "stripe_api",
  isConfigured: () => isStripeConfigured(),

  async initiatePayment(input) {
    if (!isStripeConfigured()) {
      return { status: "failed", error: NOT_CONFIGURED, code: "not_configured" };
    }
    if (input.direction === "disburse") {
      return { status: "failed", error: DISBURSEMENT_NOT_SUPPORTED, code: "unsupported" };
    }

    if (!input.returnUrl) {
      // Stripe's API rejects session creation without both URLs anyway —
      // failing here first gives a clear reason instead of a raw Stripe
      // API error, and confirms the caller never conflated the payment
      // reference with the order id (this file's header comment).
      return {
        status: "failed",
        error: "Pa gen paj pou retounen apre peman an (returnUrl manke)",
        code: "rejected",
      };
    }

    try {
      const result = await createCheckoutSession(input.reference, input.amount, {
        // Both land back on the same order page — orders.$id.tsx already
        // reads the transaction's live status regardless of which of
        // these the customer actually followed, so a cancelled Stripe
        // Checkout page just shows "pending" until the customer retries,
        // never a dead end.
        successUrl: `${input.returnUrl}?stripe=success`,
        cancelUrl: `${input.returnUrl}?stripe=cancelled`,
        description: input.description,
      });
      return {
        status: "pending",
        // Stripe's own Checkout Session id — NOT the external_reference.
        // Stored verbatim on payment_transactions.provider_transaction_id
        // by create_collect_payment_secure so checkStatus() below can
        // use it later (see this file's header comment).
        providerReference: result.providerTransactionId,
        raw: { redirectUrl: result.redirectUrl },
      };
    } catch (err) {
      return { status: "failed", error: describeError(err), code: "rejected" };
    }
  },

  /**
   * `sessionId` here is Stripe's own Checkout Session id
   * (`payment_transactions.provider_transaction_id`), NEVER
   * `external_reference` — see this file's header comment.
   */
  async checkStatus(sessionId) {
    if (!isStripeConfigured()) return { status: "unknown", error: NOT_CONFIGURED };
    try {
      const result = await retrieveCheckoutSessionById(sessionId);
      if (result.paymentStatus === "paid") {
        return {
          status: "success",
          providerReference: result.providerTransactionId,
          raw: result.raw,
        };
      }
      if (result.sessionStatus === "expired") {
        // The customer never completed payment before the session's own
        // expiry (Stripe's default: 24h) — a genuine, final failure, not
        // "still waiting".
        return { status: "failed", error: "Sesyon peman an ekspire", raw: result.raw };
      }
      // "unpaid"/"no_payment_required" with an "open" session — still
      // waiting on the customer, never a failure.
      return { status: "pending", raw: result.raw };
    } catch (err) {
      return { status: "unknown", error: describeError(err) };
    }
  },

  async cancelPayment() {
    // No cancellation endpoint applicable to a completed/pending Checkout
    // Session from the merchant side — the honest answer, matching every
    // other provider's own use of "not_cancellable" rather than an
    // invented success.
    return { status: "not_cancellable" };
  },

  async verifyWebhook(rawBody, headers) {
    const signature = headers["stripe-signature"];
    if (!signature) {
      return { valid: false, error: "Pa gen siyati Stripe nan header yo" };
    }
    try {
      const { constructWebhookEvent } = await import("./stripe-client.server");
      const event = await constructWebhookEvent(rawBody, signature);

      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.expired"
      ) {
        const session = event.data.object as {
          id: string;
          client_reference_id: string | null;
          payment_status: string;
        };
        const status =
          session.payment_status === "paid"
            ? "success"
            : event.type === "checkout.session.expired"
              ? "failed"
              : "pending";
        return {
          valid: true,
          event: {
            providerReference: session.id,
            ourReference: session.client_reference_id,
            status,
            raw: event,
          },
        };
      }

      // Any other event type Stripe might send this endpoint (we only
      // ever subscribe it to the two above in the Stripe dashboard, but a
      // misconfiguration could still deliver something else) — acknowledged
      // as valid-but-nothing-to-do, never rejected outright, since it did
      // pass signature verification and is genuinely from Stripe.
      return {
        valid: true,
        event: { providerReference: "", ourReference: null, status: "pending", raw: event },
      };
    } catch (err) {
      return { valid: false, error: describeError(err) };
    }
  },
};
