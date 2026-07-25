import type { PaymentProvider, PaymentProviderResult } from "./types";

/** Stub — see moncash-provider.ts for the rationale, identical here for NatCash. */
export const natcashProvider: PaymentProvider = {
  code: "natcash_api",
  isConfigured: () => false,
  async initiate(_amount, _receiverNumber, _receiverName): Promise<PaymentProviderResult> {
    return { success: false, error: "NatCash API pa konfigire toujou" };
  },
};
