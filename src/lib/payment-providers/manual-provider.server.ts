import type { PaymentProvider } from "./types";

/**
 * Reflects today's actual flow: the admin has already sent the money
 * themselves (via the MonCash/NatCash app on their own phone) by the time
 * `initiate_payout_secure` is called — none of these methods move money,
 * they exist only so the interface has one concrete, always-available
 * implementation to validate the contract against, and so the payout form
 * has a real default to select.
 */
export const manualProvider: PaymentProvider = {
  code: "manual",
  isConfigured: () => true,

  async initiatePayment(input) {
    return { status: "success", providerReference: input.reference };
  },

  async checkStatus(providerReference) {
    return { status: "success", providerReference };
  },

  async cancelPayment() {
    // A human already moved real money by the time this record exists —
    // there is nothing left to cancel programmatically.
    return { status: "not_cancellable" };
  },

  async verifyWebhook() {
    return { valid: false, error: "Manual provider has no webhooks" };
  },
};
