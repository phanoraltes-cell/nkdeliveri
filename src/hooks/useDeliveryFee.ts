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
      // `Number(undefined)` se NaN, epi NaN kontamine chak kalkil apre l:
      // sou paj peman an sa te bay "Total: NaN HTG" ak yon bouton konfime
      // ki rete aktif. Yon montan ki pa yon nonb fini se yon ECHÈK, se pa
      // yon valè — nou fè rekèt la echwe pou chak moun ki rele l ka trete
      // sa kòm sa (`isError`), olye yo pase NaN a pi lwen.
      const fee = Number(data?.fee_htg);
      if (!Number.isFinite(fee)) {
        throw new Error("Konfigirasyon frè livrezon an pa disponib.");
      }
      return fee;
    },
    staleTime: 5 * 60_000,
  });
}
