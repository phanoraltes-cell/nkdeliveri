import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type HiddenEntityType = "order" | "chat";

/**
 * Per-user "clean up my history" state — never a real DELETE of the
 * underlying order/chat, just a personal hide flag. RLS on
 * `hidden_history_items` ("own" — user_id = auth.uid()) already
 * guarantees a caller can only ever hide their own view, and a
 * BEFORE INSERT trigger rejects hiding anything still active or not
 * actually visible to them — this hook has nothing extra to validate.
 */
export function useHiddenHistory(entityType: HiddenEntityType) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["hidden-history", entityType, user?.id] as const;

  const query = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hidden_history_items")
        .select("entity_id")
        .eq("user_id", user!.id)
        .eq("entity_type", entityType);
      if (error) throw error;
      return data.map((r) => r.entity_id);
    },
  });

  const hiddenIds = useMemo(() => new Set(query.data ?? []), [query.data]);

  const hide = useMutation({
    mutationFn: async (entityIds: string[]) => {
      if (!user || entityIds.length === 0) return;
      const { error } = await supabase.from("hidden_history_items").upsert(
        entityIds.map((entity_id) => ({ user_id: user.id, entity_type: entityType, entity_id })),
        { onConflict: "user_id,entity_type,entity_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(e.message),
  });

  return { hiddenIds, hide, isLoading: query.isLoading };
}
