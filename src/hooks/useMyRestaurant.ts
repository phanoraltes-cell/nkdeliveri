import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MyRestaurant = { id: string; name: string; status: string; isOwner: boolean };

/**
 * Resolves "which restaurant does this user work at" for both owners and
 * staff (restaurant_employees) — owner match is tried first since it's the
 * common case and needs no join.
 */
export function useMyRestaurant(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-restaurant-or-staff", userId],
    enabled: !!userId,
    queryFn: async (): Promise<MyRestaurant | null> => {
      const { data: owned, error: ownedErr } = await supabase
        .from("restaurants")
        .select("id, name, status")
        .eq("owner_id", userId!)
        .maybeSingle();
      if (ownedErr) throw ownedErr;
      if (owned) return { ...owned, isOwner: true };

      const { data: staffRows, error: staffErr } = await supabase
        .from("restaurant_employees")
        .select("restaurants(id, name, status)")
        .eq("user_id", userId!)
        .limit(1);
      if (staffErr) throw staffErr;
      const staffRestaurant = staffRows?.[0]?.restaurants;
      if (staffRestaurant) return { ...staffRestaurant, isOwner: false };

      return null;
    },
  });
}
