import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function useFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["favorites", user?.id];

  const { data: favoriteIds = [] } = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("restaurant_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data.map((f) => f.restaurant_id);
    },
  });

  const toggle = useMutation({
    mutationFn: async (restaurantId: string) => {
      if (!user) throw new Error("Ou dwe konekte pou mete yon restoran an favori");
      if (favoriteIds.includes(restaurantId)) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("restaurant_id", restaurantId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: user.id, restaurant_id: restaurantId });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erè pandan n ap mete favori a"),
  });

  return {
    favoriteIds,
    isFavorite: (restaurantId: string) => favoriteIds.includes(restaurantId),
    toggleFavorite: toggle.mutate,
    isLoggedIn: !!user,
  };
}
