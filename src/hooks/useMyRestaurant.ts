import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MyRestaurant = {
  id: string;
  name: string;
  status: string;
  /** Manual open/close toggle (Tach 1) — see set_restaurant_open_secure. */
  isOpen: boolean;
  isOwner: boolean;
  /** The specific restaurant_employees.role for staff (staff/manager/cook/prep/cashier/supervisor); null for owners. */
  employeeRole: string | null;
};

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
        .select("id, name, status, is_open")
        .eq("owner_id", userId!)
        .maybeSingle();
      if (ownedErr) throw ownedErr;
      if (owned) {
        const { is_open, ...rest } = owned;
        return { ...rest, isOpen: is_open, isOwner: true, employeeRole: null };
      }

      const { data: staffRows, error: staffErr } = await supabase
        .from("restaurant_employees")
        .select("role, restaurants(id, name, status, is_open)")
        .eq("user_id", userId!)
        .limit(1);
      if (staffErr) throw staffErr;
      const staffRow = staffRows?.[0];
      if (staffRow?.restaurants) {
        const { is_open, ...rest } = staffRow.restaurants;
        return { ...rest, isOpen: is_open, isOwner: false, employeeRole: staffRow.role };
      }

      return null;
    },
  });
}
