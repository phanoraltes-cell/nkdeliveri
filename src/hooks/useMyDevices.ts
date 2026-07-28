import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isPushSupported } from "@/lib/push";

/**
 * "Mes appareils" — every push-registered browser/device for the current
 * user, backed directly by push_subscriptions (RLS already scopes it to
 * `user_id = auth.uid()`, no RPC needed for any of these — same "self-
 * scoped table" precedent as active-sessions/hidden_history_items).
 */
export function useMyDevices() {
  const qc = useQueryClient();
  const queryKey = ["my-push-devices"] as const;

  const devices = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, user_agent, created_at, last_used_at, enabled")
        .order("last_used_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const currentEndpoint = useQuery({
    queryKey: ["my-current-push-endpoint"],
    enabled: isPushSupported(),
    queryFn: async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const sub = await reg?.pushManager.getSubscription();
      return sub?.endpoint ?? null;
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aparèy retire");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e.message),
  });

  const setEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("push_subscriptions").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.enabled ? "Notifikasyon aktive pou aparèy sa a" : "Notifikasyon anpeche pou aparèy sa a",
      );
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e.message),
  });

  return { devices, currentEndpoint: currentEndpoint.data, remove, setEnabled };
}
