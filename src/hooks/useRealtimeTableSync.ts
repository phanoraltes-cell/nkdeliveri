import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to postgres_changes on `table` and invalidates the given
 * query keys on any event — same channel/invalidate shape as useLiveOrders,
 * factored out since the commission/payout pages all need the identical
 * "something changed on wallets → refetch this page's queries" wiring.
 * `filter` follows PostgREST filter syntax (e.g. `restaurant_id=eq.<id>`);
 * pass undefined to listen to every row (used by the admin-wide pages).
 */
export function useRealtimeTableSync(
  table: string,
  filter: string | undefined,
  queryKeys: readonly (readonly unknown[])[],
  enabled = true,
) {
  const qc = useQueryClient();
  const filterKey = filter ?? "";

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`realtime-sync-${table}-${filterKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => {
          for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filterKey, enabled]);
}
