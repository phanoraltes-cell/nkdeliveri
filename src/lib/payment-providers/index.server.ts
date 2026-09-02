import type { PaymentProvider, PaymentProviderCode } from "./types";
import { manualProvider } from "./manual-provider.server";
import { plopProvider } from "./plop-provider.server";
import { stripeProvider } from "./stripe-provider.server";

export type {
  PaymentProvider,
  PaymentProviderCode,
  PaymentDirection,
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentStatusResult,
  CancelPaymentResult,
  PaymentWebhookEvent,
  WebhookVerifyResult,
} from "./types";

/**
 * Registry — the one place a future real provider gets added to the app,
 * and the *only* place `initiate-provider-payout.functions.ts` (or any
 * future webhook route) is allowed to reach a provider through. Never
 * import moncash-provider.server.ts/natcash-provider.server.ts directly —
 * always through getPaymentProvider(), so there is exactly one call site
 * to audit for "is this still the only place MonCash-specific code runs."
 *
 * `payment_providers.is_active` (the DB row) is the actual gate the admin
 * form respects; this registry only needs to grow by one import + one
 * entry per new provider, never a rewrite of the payout flow itself.
 *
 * PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE), Tach 3 — `moncash_api`
 * and `natcash_api` both now resolve to `plopProvider` (its real
 * Withdrawal API, plop-provider.server.ts), replacing the dormant
 * Digicel-direct (`moncash-provider.server.ts`, always refused disburse)
 * and unconfigured-stub (`natcash-provider.server.ts`) implementations —
 * same "swap the implementation behind a stable provider_code" pattern
 * already used for Collect (§ header comment on plop-provider.server.ts).
 * `moncash-provider.server.ts`/`natcash-provider.server.ts` are kept on
 * disk (legacy, unreferenced from this registry now) rather than deleted
 * — out of scope for this change to remove them outright.
 */
const PROVIDERS: Record<PaymentProviderCode, PaymentProvider> = {
  manual: manualProvider,
  moncash_api: plopProvider,
  natcash_api: plopProvider,
  // Present here only because `PaymentProviderCode`'s type requires every
  // code to have a registry entry (TypeScript completeness) — Collect
  // never reaches stripeProvider through this registry (it's imported
  // directly by initiate-collect-payment.logic.ts, same as plopProvider,
  // docs/archive/audits/STRIPE_INTEGRATION_REPORT.md), and this app has no card-based
  // payout to route here either. Kept safe regardless: stripeProvider's
  // own initiatePayment() refuses `direction: "disburse"` defensively,
  // exactly like every other provider in this registry.
  stripe_api: stripeProvider,
};

export function getPaymentProvider(code: string): PaymentProvider | undefined {
  return PROVIDERS[code as PaymentProviderCode];
}
