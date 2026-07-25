import type { PaymentProvider, PaymentProviderResult } from "./types";

/**
 * Reflects today's actual flow: the admin has already sent the money
 * themselves (via the MonCash/NatCash app on their own phone) by the time
 * `initiate_payout_secure` is called — this provider's `initiate()` is
 * never really invoked to *move* money, it exists only so the interface
 * has one concrete, always-available implementation to validate the
 * contract against, and so `payout-pay-modal.tsx` has a real default to
 * select.
 */
export const manualProvider: PaymentProvider = {
  code: "manual",
  isConfigured: () => true,
  async initiate(_amount, _receiverNumber, _receiverName): Promise<PaymentProviderResult> {
    return { success: true };
  },
};
