import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Minimal client-side safety net for the opening-hours check
 * (20260821100000_restaurant_open_check_order_creation.sql) — NOT the real
 * gate (that's `public.is_restaurant_open()` re-evaluated server-side
 * inside `create_order_secure` regardless of what this hook returns). This
 * only exists so a customer sees "Fèmen" before they fill a cart and hit a
 * wall at final checkout, the same "UI = convenience, server = barrier"
 * split already used for ContractGate/TermsAcceptanceGate.
 *
 * Short `staleTime` + `refetchInterval`, unlike useDeliveryFee's generous
 * one — open/closed is genuinely live (crosses a boundary every single
 * day, unlike an admin-set price that changes rarely), and a customer can
 * realistically leave a restaurant page open across its own closing time.
 */
export function useIsRestaurantOpen(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ["restaurant-open", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_restaurant_open", {
        _restaurant_id: restaurantId!,
      });
      if (error) throw error;
      return data as boolean;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
