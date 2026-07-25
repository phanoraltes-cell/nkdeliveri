import type { PaymentProvider, PaymentProviderCode } from "./types";
import { manualProvider } from "./manual-provider";
import { moncashProvider } from "./moncash-provider";
import { natcashProvider } from "./natcash-provider";

export type { PaymentProvider, PaymentProviderCode, PaymentProviderResult } from "./types";

/**
 * Registry — the one place a future real provider gets added to the app.
 * `payment_providers.is_active` (the DB row) is the actual gate the admin
 * form respects; this registry only needs to grow by one import + one
 * entry per new provider, never a rewrite of the payout flow itself.
 */
const PROVIDERS: Record<PaymentProviderCode, PaymentProvider> = {
  manual: manualProvider,
  moncash_api: moncashProvider,
  natcash_api: natcashProvider,
};

export function getPaymentProvider(code: string): PaymentProvider | undefined {
  return PROVIDERS[code as PaymentProviderCode];
}
