/**
 * Pure presentation layer for `PaymentProviderCode` — never a data
 * change. `payment_transactions.provider`/`payment_providers.code` stay
 * `moncash_api` (docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 1); this module only
 * decides what an admin *sees* for that code, so the underlying rail can
 * be swapped (Digicel → PLOP, or any future replacement) without a
 * migration or a data rewrite every time.
 *
 * Originally scoped to Collect only (`moncash_api` on the payout side
 * used to mean the dormant Digicel-direct integration, never PLOP). Tach
 * 3 (PROMPT MODIFIKASYON WALLET/DEKÈSMAN/PIBLISITE) changed that: both
 * `moncash_api` and `natcash_api` now resolve to `plopProvider` on the
 * payout side too (index.server.ts) — `payout-pay-modal.tsx` still
 * doesn't consume this module (its own local `PAYOUT_CHANNELS` labels
 * already say "Automatik" without exposing the internal code), but the
 * map below is corrected regardless so it's never wrong if a future
 * payout-facing screen does start consuming it.
 *
 * No `.server.ts` suffix: this is plain data + a pure function, safe in
 * both server and client bundles (same category as
 * payment-provider-availability.ts's own display constants).
 */
import type { PaymentProviderCode } from "@/lib/payment-providers/types";

export const PROVIDER_CODE_DISPLAY_LABELS: Record<PaymentProviderCode, string> = {
  manual: "Manyèl",
  // ex-"MonCash API"/"NatCash API" (still the literal payment_providers
  // .label seed values, intentionally left alone in the DB — see module
  // comment above) — never surfaced verbatim on any admin screen.
  moncash_api: "PLOP",
  natcash_api: "PLOP",
  stripe_api: "Stripe",
};

/** Falls back to the raw code for any value this map doesn't recognize, rather than throwing — an admin screen should degrade gracefully, never crash, on an unexpected provider string. */
export function getProviderDisplayLabel(code: string): string {
  return PROVIDER_CODE_DISPLAY_LABELS[code as PaymentProviderCode] ?? code;
}
