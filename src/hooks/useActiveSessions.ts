import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Sessions actives" — reads/writes Supabase Auth's own auth.sessions
 * table (via get_my_active_sessions_secure/revoke_my_session_secure, see
 * the 20260728110xxx migrations), never a parallel session store.
 * Revoking every *other* device uses the official client SDK method
 * (supabase.auth.signOut({ scope: "others" })) instead of a custom RPC —
 * already the established pattern in this codebase, see
 * change-password-form.tsx.
 */
export function useActiveSessions() {
  const qc = useQueryClient();
  const queryKey = ["my-active-sessions"] as const;

  const sessions = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_active_sessions_secure");
      if (error) throw error;
      return data;
    },
  });

  const revokeOne = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc("revoke_my_session_secure", {
        _session_id: sessionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sesyon an dekonekte");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tout lòt aparèy dekonekte");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e.message),
  });

  return { sessions, revokeOne, revokeOthers };
}
