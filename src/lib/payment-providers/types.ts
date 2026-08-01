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
export type PaymentProviderCode = "manual" | "moncash_api" | "natcash_api";

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
};

export type InitiatePaymentResult =
  | { status: "success"; providerReference: string; raw?: unknown }
  | { status: "pending"; providerReference?: string; raw?: unknown }
  | {
      status: "failed";
      error: string;
      /** Coarse reason a caller can act on without parsing `error` text — e.g. the admin "timeout" notification vs. a generic failure one. Optional: not every provider/failure distinguishes these. */
      code?: "timeout" | "not_configured" | "unsupported" | "rejected";
      raw?: unknown;
    };

export type PaymentStatusResult =
  | { status: "success"; providerReference: string; raw?: unknown }
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
  /** Poll the provider directly for a payment's current state — the reconciliation path for a request that timed out on our side but may have still succeeded on theirs. */
  checkStatus(providerReference: string): Promise<PaymentStatusResult>;
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
