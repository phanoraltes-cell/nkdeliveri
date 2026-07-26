import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Active sponsored placements for one ad zone (Phase 6 of the admin
 * evolution plan). Public data — works for signed-out visitors browsing
 * home/search, same as the pages that call it. Returns [] (never throws
 * into the UI) so a missing/expired campaign just renders nothing, not an
 * error state — an ad zone is never load-bearing for the page around it.
 */
export function useActivePlacements(
  placement: "home_banner" | "search_results" | "restaurant_page" | "dashboard",
  limit = 3,
) {
  return useQuery({
    queryKey: ["sponsored-placements", placement, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_placements_secure", {
        _placement: placement,
        _limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
