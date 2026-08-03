import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPaymentProviderSettings } from "@/lib/payment-provider-availability";

/**
 * Checkout-facing read of `payment_provider_settings` — the frontend's
 * only window into which methods are visible/enabled/default, always
 * through PaymentProviderAvailabilityService (payment-provider-
 * availability.ts), never a direct table query duplicated here. The
 * backend enforces the real gate independently in
 * initiate-collect-payment.logic.ts — this hook only decides what the UI
 * *shows*, never what it *allows*.
 */
export function usePaymentProviderAvailability() {
  return useQuery({
    queryKey: ["payment-provider-settings"],
    queryFn: () => fetchPaymentProviderSettings(supabase),
    staleTime: 60_000,
  });
}
