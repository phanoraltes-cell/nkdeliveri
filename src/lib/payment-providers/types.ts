/**
 * Provider abstraction for the "who executes this payout" axis (Phase 3
 * of the admin evolution plan) — distinct from `payment_methods`
 * (moncash/natcash), which describes *which rail* the money moves
 * through. Today, every payout is executed manually by an admin
 * regardless of rail; a real MonCash/NatCash API integration implements
 * this interface, without touching `initiate_payout_secure`'s manual
 * flow at all.
 *
 * A real integration cannot live in Postgres (a SECURITY DEFINER
 * function has no outbound network access) — it belongs in a `.server.ts`
 * module (never a `.ts`/`.tsx` a React component could import) called
 * from a TanStack Start server function, which then records the outcome
 * via `initiate_payout_secure`'s existing `_provider_code` parameter. See
 * `initiate-provider-payout.functions.ts` for the one and only place this
 * interface is actually invoked — no page or component may call a
 * provider directly.
 */
export type PaymentProviderCode = "manual" | "moncash_api" | "natcash_api" | "stripe_api";

export type PaymentDirection = "collect" | "disburse";

export type InitiatePaymentInput = {
  /** "disburse" = platform → beneficiary (a payout); "collect" = customer → platform (a future checkout gateway). Every provider today only implements disburse. */
  direction: PaymentDirection;
  amount: number;
  /** E.164-ish local format, e.g. "+509XXXXXXXX" — whatever the beneficiary has on file. Disbursement only — a "collect" call has no counterparty to name, the customer pays through their own MonCash app. */
  counterpartyNumber?: string;
  counterpartyName?: string | null;
  /** Our own id (payout id today) — passed through so a provider that supports idempotency keys can use it; also what a later webhook must be matched back against. */
  reference: string;
  description?: string;
  /**
   * Optional per-call payment-method/wallet hint (e.g. PLOP's own
   * `moncash`|`kashpaw`|`natcash`|`all` — docs/archive/plop/PLOP_PHASE0_AUDIT.md § 7).
   * Providers that route through a single fixed rail (MonCash Digicel,
   * NatCash) simply ignore this. Added specifically so a multi-wallet
   * gateway (PLOP) is never forced to rely on one global config value for
   * every transaction — docs/archive/plop/PLOP_MULTIWALLET_PHASE0_AUDIT.md §§ 2, 6.
   */
  paymentMethod?: string;
  /**
   * Absolute URL to send the customer back to once they're done on the
   * provider's own page — required by providers whose API mandates a
   * real return URL at creation time (Stripe Checkout Sessions'
   * `success_url`/`cancel_url`, docs/archive/audits/STRIPE_INTEGRATION_REPORT.md).
   * Ignored by providers that don't need one (PLOP documents no
   * `return_url` parameter at all — docs/archive/plop/PLOP_PHASE0_AUDIT.md § 9).
   * Always the order page (`/orders/:id`), never the payment reference —
   * a provider must never assume `reference` and the order id are
   * interchangeable.
   */
  returnUrl?: string;
};

export type InitiatePaymentResult =
  | {
      status: "success";
      providerReference: string;
      /** Which wallet the provider actually processed this through, when it can say (e.g. PLOP's `paiement-verify.method`) — distinct from `paymentMethod` above, which is only what was *requested*. `undefined`/`null` for providers that don't expose this. */
      walletUsed?: string | null;
      raw?: unknown;
    }
  | { status: "pending"; providerReference?: string; raw?: unknown }
  | {
      status: "failed";
      error: string;
      /** Coarse reason a caller can act on without parsing `error` text — e.g. the admin "timeout" notification vs. a generic failure one. Optional: not every provider/failure distinguishes these. */
      code?: "timeout" | "not_configured" | "unsupported" | "rejected" | "invalid_wallet";
      raw?: unknown;
    };

export type PaymentStatusResult =
  | { status: "success"; providerReference: string; walletUsed?: string | null; raw?: unknown }
  | { status: "pending"; raw?: unknown }
  | { status: "failed"; error: string; raw?: unknown }
  /** The provider itself couldn't say — a network/auth error asking the status, not a real "the payment failed". Callers must not treat this as failure. */
  | { status: "unknown"; error: string };

export type CancelPaymentResult =
  | { status: "cancelled" }
  | { status: "failed"; error: string }
  /** Most mobile-money rails can't cancel a transfer once submitted — this is the honest answer, not a failure. */
  | { status: "not_cancellable" };

export type PaymentWebhookEvent = {
  providerReference: string;
  /** Our own `reference` from InitiatePaymentInput, if the provider echoes it back — null if the payload doesn't carry it and the caller must look it up by providerReference instead. */
  ourReference: string | null;
  status: "success" | "failed" | "pending";
  amount?: number;
  raw: unknown;
};

export type WebhookVerifyResult =
  { valid: true; event: PaymentWebhookEvent } | { valid: false; error: string };

export interface PaymentProvider {
  code: PaymentProviderCode;
  /** True once this provider has real, validated credentials — false hides it from the admin UI (`payment_providers.is_active` is the DB-side mirror of this, flipped by hand once a real integration lands). */
  isConfigured(): boolean;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  /**
   * Poll the provider directly for a payment's current state — the
   * reconciliation path for a request that timed out on our side but may
   * have still succeeded on theirs. `direction` disambiguates providers
   * (PLOP, Tach 3) that use one method for two structurally different
   * lookups (Collect's `verifyPayment` vs Withdrawal's `verifyWithdrawal`)
   * — defaults to `"collect"` so every pre-existing caller (checking a
   * customer payment) keeps its current behavior unchanged; a
   * disbursement-reconciliation caller passes `"disburse"` explicitly.
   * Providers that only ever do one direction (MonCash, NatCash, Stripe,
   * manual) simply ignore this parameter.
   */
  checkStatus(
    providerReference: string,
    direction?: PaymentDirection,
  ): Promise<PaymentStatusResult>;
  cancelPayment(providerReference: string): Promise<CancelPaymentResult>;
  /**
   * Validates an inbound webhook's authenticity (signature/HMAC per the
   * provider's own scheme) and parses it into a normalized event. Never
   * trust an unverified webhook body — this is the one place that check
   * belongs, so every provider is forced to implement it explicitly
   * rather than a caller assuming a payload is genuine.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult>;
}
