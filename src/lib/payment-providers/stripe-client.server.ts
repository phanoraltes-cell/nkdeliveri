/**
 * Low-level Stripe API client — Checkout Sessions only (Collect). Unlike
 * plop-client.server.ts/moncash-client.server.ts, this wraps the official
 * `stripe` Node SDK rather than hand-rolling HTTP + retry logic: Stripe
 * publishes and maintains that SDK themselves (idempotency, retries,
 * typed responses, webhook signature verification), so re-implementing
 * any of that by hand here would only be a worse, unmaintained copy of
 * something already done correctly upstream — a different tradeoff than
 * PLOP, which has no SDK at all (docs/PLOP_PHASE0_AUDIT.md).
 *
 * `.server.ts` is load-bearing: the build fails if a route file or
 * component imports this module, keeping `STRIPE_SECRET_KEY` out of the
 * browser bundle by construction.
 *
 * Every attempt is journaled to `stripe_api_logs` — schema matrix-matched
 * to `plop_api_logs`/`moncash_api_logs` (see the migration that creates
 * it). Logging is always best-effort: a logging failure must never break
 * a real payment flow, so it only ever warns, never throws.
 *
 * IMPORTANT — currency (see stripe-config.server.ts's own doc comment for
 * the full explanation): every amount in this app is HTG, but Stripe very
 * likely cannot settle in HTG directly, and Haiti is not one of Stripe's
 * supported account countries at all. This client charges in
 * `presentmentCurrency` (from config, e.g. "usd"), converting from HTG
 * via `htgConversionRate` — a manually-configured rate, never invented
 * here. See docs/STRIPE_INTEGRATION_REPORT.md.
 */
import type { Json } from "@/integrations/supabase/types";
import { getStripeConfig } from "./stripe-config.server";

export class StripeApiError extends Error {
  readonly code?: string;
  readonly raw?: unknown;

  constructor(message: string, code?: string, raw?: unknown) {
    super(message);
    this.name = "StripeApiError";
    this.code = code;
    this.raw = raw;
  }
}

type StripeClient = import("stripe").default;
let cachedClient: StripeClient | undefined;

async function getClient(): Promise<StripeClient> {
  if (cachedClient) return cachedClient;
  const { secretKey } = getStripeConfig();
  const { default: Stripe } = await import("stripe");
  // Pinned apiVersion — Stripe's own recommendation, so a Stripe-side
  // account default change can never silently alter this integration's
  // behavior without an explicit code change here.
  cachedClient = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia", typescript: true });
  return cachedClient;
}

async function writeApiLog(entry: {
  endpoint: string;
  httpStatus: number | null;
  durationMs: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown> | null;
  error: string | null;
  transactionReference: string | null;
  providerTransactionId: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("stripe_api_logs").insert({
      endpoint: entry.endpoint,
      method: "POST",
      attempt: 1,
      http_status: entry.httpStatus,
      duration_ms: entry.durationMs,
      request_summary: entry.requestSummary as Json,
      response_summary: entry.responseSummary as Json | null,
      error: entry.error,
      is_timeout: false,
      transaction_reference: entry.transactionReference,
      provider_transaction_id: entry.providerTransactionId,
    });
    if (error) console.warn("[stripe] failed to write API audit log", error.message);
  } catch (err) {
    console.warn("[stripe] failed to write API audit log", err);
  }
}

export type StripeCreateSessionResult = {
  redirectUrl: string;
  providerTransactionId: string; // Stripe Checkout Session id ("cs_...")
};

/**
 * `reference` becomes both `client_reference_id` and `metadata.reference`
 * on the session — the webhook handler and polling checkStatus() both
 * need a reliable way to map a Stripe object back to our own
 * `payment_transactions.external_reference`, and Stripe doesn't echo an
 * arbitrary caller-supplied id anywhere else on a Checkout Session.
 */
export async function createCheckoutSession(
  reference: string,
  amountHtg: number,
  opts: { successUrl: string; cancelUrl: string; description?: string },
): Promise<StripeCreateSessionResult> {
  const { presentmentCurrency, htgConversionRate } = getStripeConfig();
  const unitAmount = Math.round(amountHtg * htgConversionRate * 100); // smallest unit (e.g. cents)
  const start = Date.now();
  const requestSummary = {
    reference,
    amount_htg: amountHtg,
    presentment_currency: presentmentCurrency,
    unit_amount: unitAmount,
  };

  try {
    const stripe = await getClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: reference,
      metadata: { reference },
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: presentmentCurrency,
            unit_amount: unitAmount,
            product_data: { name: opts.description ?? "Kòmand NK Deliveri" },
          },
        },
      ],
    });
    if (!session.url) {
      throw new StripeApiError("Stripe pa retounen yon lyen peman", "no_url", session);
    }
    await writeApiLog({
      endpoint: "checkout.sessions.create",
      httpStatus: 200,
      durationMs: Date.now() - start,
      requestSummary,
      responseSummary: { id: session.id, status: session.status },
      error: null,
      transactionReference: reference,
      providerTransactionId: session.id,
    });
    return { redirectUrl: session.url, providerTransactionId: session.id };
  } catch (err) {
    const message = describeStripeError(err);
    await writeApiLog({
      endpoint: "checkout.sessions.create",
      httpStatus: httpStatusOf(err),
      durationMs: Date.now() - start,
      requestSummary,
      responseSummary: null,
      error: message,
      transactionReference: reference,
      providerTransactionId: null,
    });
    if (err instanceof StripeApiError) throw err;
    throw new StripeApiError(message, codeOf(err), err);
  }
}

export type StripeSessionStatus = {
  /** Stripe's own `payment_status` — "paid" is the only real success signal; "unpaid"/"no_payment_required" both mean "not yet", never treated as failure. */
  paymentStatus: string;
  sessionStatus: string; // "open" | "complete" | "expired"
  providerTransactionId: string;
  raw: unknown;
};

/**
 * Looks up a session directly by Stripe's own id — the ONLY lookup path
 * this client offers, deliberately: Stripe's Checkout Session `list` API
 * has no server-side filter for `client_reference_id` (confirmed against
 * the SDK's own type signature — only `customer`/`payment_intent`/
 * `subscription`/`created`/pagination cursors are supported), so there is
 * no reliable way to "find my session by my own reference" after the
 * fact. This is why `create_collect_payment_secure` was extended with an
 * optional `_provider_transaction_id` param
 * (docs/STRIPE_INTEGRATION_REPORT.md) — the session id returned by
 * `createCheckoutSession` above is stored on the `payment_transactions`
 * row immediately, specifically so every later lookup (polling,
 * checkStatus) always has it on hand and never needs to search for it.
 */
export async function retrieveCheckoutSessionById(sessionId: string): Promise<StripeSessionStatus> {
  const start = Date.now();
  try {
    const stripe = await getClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    await writeApiLog({
      endpoint: "checkout.sessions.retrieve",
      httpStatus: 200,
      durationMs: Date.now() - start,
      requestSummary: { session_id: sessionId },
      responseSummary: { payment_status: session.payment_status, status: session.status },
      error: null,
      transactionReference: session.client_reference_id,
      providerTransactionId: session.id,
    });
    return {
      paymentStatus: session.payment_status,
      sessionStatus: session.status ?? "open",
      providerTransactionId: session.id,
      raw: { id: session.id, payment_status: session.payment_status, status: session.status },
    };
  } catch (err) {
    const message = describeStripeError(err);
    await writeApiLog({
      endpoint: "checkout.sessions.retrieve",
      httpStatus: httpStatusOf(err),
      durationMs: Date.now() - start,
      requestSummary: { session_id: sessionId },
      responseSummary: null,
      error: message,
      transactionReference: null,
      providerTransactionId: sessionId,
    });
    throw new StripeApiError(message, codeOf(err), err);
  }
}

/**
 * Verifies an inbound webhook's signature via Stripe's own SDK helper —
 * never hand-rolled HMAC comparison here, exactly the kind of
 * security-critical primitive that belongs to the maintained SDK, not a
 * reimplementation (docs/STRIPE_INTEGRATION_REPORT.md).
 */
export async function constructWebhookEvent(
  rawBody: string,
  signatureHeader: string,
): Promise<import("stripe").default.Event> {
  const { webhookSecret } = getStripeConfig();
  const stripe = await getClient();
  // Throws Stripe.errors.StripeSignatureVerificationError on a bad/missing
  // signature — the caller (stripe-provider.server.ts's verifyWebhook)
  // catches this and reports { valid: false }, never lets an unverified
  // payload through.
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

function describeStripeError(err: unknown): string {
  if (err instanceof StripeApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erè Stripe san detay";
}

function httpStatusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const status = (err as { statusCode?: unknown }).statusCode;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function codeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
