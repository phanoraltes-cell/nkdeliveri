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
  placement: "home_banner" | "search_results" | "restaurant_page" | "dashboard" | "popup",
  limit = 3,
  // Tach 2 (piblisite) — sèlman itilize pou "popup" jodi a: filtre anplis
  // sou dashboard_targets ("public", "dashboard_customer", ...) kote popup
  // la gen dwa parèt. `undefined` = pa gen filtraj (konpòtman ansyen an,
  // toujou itilize pa lòt placement yo).
  context?: string,
) {
  return useQuery({
    queryKey: ["sponsored-placements", placement, limit, context],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_placements_secure", {
        _placement: placement,
        _limit: limit,
        _context: context,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
