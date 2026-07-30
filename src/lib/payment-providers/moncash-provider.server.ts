import type { PaymentProvider } from "./types";

// No real MonCash API integration exists yet: no confirmed API contract
// for B2C disbursement (MonCash's public API is historically a merchant
// *collection* gateway — see the "Audit intégration MonCash" report for
// why this needs verifying with Digicel before any real HTTP call is
// written here), and no credentials are provisioned anywhere (checked:
// absent from both .env.local and Vercel production/preview). This file
// fixes the *shape* a real integration will take, so wiring one in later
// is "implement these four methods and flip
// payment_providers.moncash_api.is_active to true", never a redesign of
// initiate_payout_secure, initiate-provider-payout.functions.ts, or the
// admin payout form.
//
// `.server.ts` is load-bearing, not stylistic: it's what keeps a real
// implementation's future MONCASH_CLIENT_SECRET out of the client bundle
// by construction — the build fails if a route file or component ever
// imports this module directly, the exact "never call MonCash from a
// React component" rule this file exists to enforce.
const NOT_CONFIGURED = "MonCash API pa konfigire toujou";

export const moncashProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => false,

  async initiatePayment() {
    return { status: "failed", error: NOT_CONFIGURED };
  },

  async checkStatus() {
    return { status: "unknown", error: NOT_CONFIGURED };
  },

  async cancelPayment() {
    return { status: "failed", error: NOT_CONFIGURED };
  },

  async verifyWebhook() {
    return { valid: false, error: NOT_CONFIGURED };
  },
};
