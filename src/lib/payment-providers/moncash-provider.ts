import type { PaymentProvider, PaymentProviderResult } from "./types";

/**
 * Stub — no real MonCash API integration exists yet (no API credentials,
 * no confirmed API contract). This exists to fix the *shape* a real
 * integration will take, so wiring one in later is "implement these two
 * methods and flip `payment_providers.moncash_api.is_active` to true",
 * not a redesign of `initiate_payout_secure` or the admin payout form.
 * `isConfigured()` returning false is what keeps this provider hidden
 * from the admin UI until a real integration replaces this file.
 */
export const moncashProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => false,
  async initiate(_amount, _receiverNumber, _receiverName): Promise<PaymentProviderResult> {
    return { success: false, error: "MonCash API pa konfigire toujou" };
  },
};
