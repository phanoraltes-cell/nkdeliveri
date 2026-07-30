import type { PaymentProvider } from "./types";
import { isMonCashConfigured } from "./moncash-config.server";

// No real MonCash API integration exists yet: no confirmed API contract
// for B2C disbursement (MonCash's public API is historically a merchant
// *collection* gateway — see the "Audit intégration MonCash" report for
// why this needs verifying with Digicel before any real HTTP call is
// written here). `isConfigured()` below is wired to the real secrets
// (see moncash-config.server.ts) so that setting them in production
// meaningfully changes this provider's state — but every method still
// returns "not implemented" regardless, because no verified endpoint
// shapes exist to call yet. This file fixes the *shape* a real
// integration will take, so wiring one in later is "implement these four
// method bodies and flip payment_providers.moncash_api.is_active to
// true", never a redesign of initiate_payout_secure,
// initiate-provider-payout.functions.ts, or the admin payout form.
//
// `.server.ts` is load-bearing, not stylistic: it's what keeps
// MONCASH_CLIENT_SECRET/MONCASH_WEBHOOK_SECRET out of the client bundle
// by construction — the build fails if a route file or component ever
// imports this module (or moncash-config.server.ts) directly, the exact
// "never call MonCash from a React component" rule this file exists to
// enforce. See docs/PAYMENT_PROVIDERS.md for the full setup procedure.
const NOT_CONFIGURED = "MonCash API pa konfigire toujou";
const NOT_IMPLEMENTED =
  "Sekrè MonCash yo konfigire, men entegrasyon API a poko ekri — kontra API a poko konfime ak Digicel.";

function unavailableReason(): string {
  return isMonCashConfigured() ? NOT_IMPLEMENTED : NOT_CONFIGURED;
}

export const moncashProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => isMonCashConfigured(),

  async initiatePayment() {
    return { status: "failed", error: unavailableReason() };
  },

  async checkStatus() {
    return { status: "unknown", error: unavailableReason() };
  },

  async cancelPayment() {
    return { status: "failed", error: unavailableReason() };
  },

  async verifyWebhook() {
    return { valid: false, error: unavailableReason() };
  },
};
