/**
 * Provider abstraction for the "who executes this payout" axis (Phase 3
 * of the admin evolution plan) — distinct from `payment_methods`
 * (moncash/natcash), which describes *which rail* the money moves
 * through. Today, every payout is executed manually by an admin
 * regardless of rail; this interface is the contract a real MonCash/
 * NatCash API integration will implement later, without touching
 * `initiate_payout_secure`'s manual flow at all.
 *
 * A real integration cannot live in Postgres (a SECURITY DEFINER
 * function has no outbound network access) — it belongs here, in a
 * server function that calls the provider's API, then records the
 * outcome via `initiate_payout_secure`'s existing `_provider_code`
 * parameter (and, later, a status-check RPC once a provider actually
 * needs one).
 */
export type PaymentProviderCode = "manual" | "moncash_api" | "natcash_api";

export type PaymentProviderResult = {
  success: boolean;
  /** The provider's own transaction reference, if it executed the transfer itself. */
  reference?: string;
  error?: string;
};

export interface PaymentProvider {
  code: PaymentProviderCode;
  /** True once this provider is safe to offer to an admin — false for any provider without a real, configured integration yet. */
  isConfigured(): boolean;
  initiate(
    amount: number,
    receiverNumber: string,
    receiverName: string | null,
  ): Promise<PaymentProviderResult>;
}
