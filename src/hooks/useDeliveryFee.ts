import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * NKD-015 — the platform-wide delivery fee, read from
 * public.platform_delivery_zones (the default zone; no per-address zone
 * matching exists yet, see supabase/migrations/20260816120000_
 * nkd015_delivery_fee_config.sql). Shared by every place that needs to
 * display it — checkout, restaurant listing/detail cards — so there's one
 * query key and one cache entry instead of each call site re-fetching.
 *
 * `staleTime` is generous: this is an admin-set price that changes rarely
 * (an explicit admin action, step-up gated), not live data — no reason to
 * refetch it as often as order/delivery data.
 */
export function useDeliveryFee() {
  return useQuery({
    queryKey: ["platform-delivery-fee"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_delivery_zones")
        .select("fee_htg")
        .eq("is_default", true)
        .single();
      if (error) throw error;
      return Number(data.fee_htg);
    },
    staleTime: 5 * 60_000,
  });
}
