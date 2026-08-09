/**
 * Pure presentation layer for `PaymentProviderCode` — never a data
 * change. `payment_transactions.provider`/`payment_providers.code` stay
 * `moncash_api` (docs/PLOP_PHASE1_ARCHITECTURE.md § 1); this module only
 * decides what an admin *sees* for that code, so the underlying rail can
 * be swapped (Digicel → PLOP, or any future replacement) without a
 * migration or a data rewrite every time.
 *
 * Deliberately scoped to the **Collect** admin surfaces this replacement
 * is about — no existing décaissement (payout) file
 * (`payout-pay-modal.tsx`) consumes this
 * today, and none should be retrofitted to as part of this chantier: on
 * the payout side, `moncash_api` still genuinely means the dormant
 * Digicel-direct integration, never PLOP (docs/PLOP_REMEDIATION_REPORT.md
 * § "Objectif 4"). This module exists ahead of its first real consumer —
 * the first Collect-facing admin view (Phase 6) — precisely so that view
 * never has a reason to hardcode "MonCash API" for what is actually PLOP.
 *
 * No `.server.ts` suffix: this is plain data + a pure function, safe in
 * both server and client bundles (same category as
 * payment-provider-availability.ts's own display constants).
 */
import type { PaymentProviderCode } from "@/lib/payment-providers/types";

export const PROVIDER_CODE_DISPLAY_LABELS: Record<PaymentProviderCode, string> = {
  manual: "Manyèl",
  // ex-"MonCash API" (still the literal payment_providers.label seed
  // value on the payout side, intentionally left alone — see module
  // comment above) — never surfaced verbatim on any Collect-facing
  // admin screen.
  moncash_api: "PLOP",
  natcash_api: "NatCash API",
  stripe_api: "Stripe",
};

/** Falls back to the raw code for any value this map doesn't recognize, rather than throwing — an admin screen should degrade gracefully, never crash, on an unexpected provider string. */
export function getProviderDisplayLabel(code: string): string {
  return PROVIDER_CODE_DISPLAY_LABELS[code as PaymentProviderCode] ?? code;
}
