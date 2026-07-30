import type { PaymentProvider } from "./types";

/** Stub — see moncash-provider.server.ts for the full rationale, identical here for NatCash. */
const NOT_CONFIGURED = "NatCash API pa konfigire toujou";

export const natcashProvider: PaymentProvider = {
  code: "natcash_api",
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
