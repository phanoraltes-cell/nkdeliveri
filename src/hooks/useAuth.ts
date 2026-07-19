import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session AND
    // getSession() below resolves independently — both can kick off a
    // get_primary_role RPC for the same or a different user. currentUserId
    // guards against the slower one winning and overwriting `role` with a
    // stale value (e.g. sign-out then sign back in as another account
    // before the first RPC has returned).
    let currentUserId: string | null = null;

    function applyRole(forUserId: string, roleResult: string | null) {
      if (forUserId === currentUserId) setRole(roleResult);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      currentUserId = s?.user?.id ?? null;
      if (s?.user) {
        const userId = s.user.id;
        // .rpc() returns a PostgrestBuilder, which is thenable but not a
        // real Promise (no .catch()) — use the two-arg .then(ok, err) form.
        supabase.rpc("get_primary_role", { _user_id: userId }).then(
          ({ data }) => applyRole(userId, (data as string | null) ?? null),
          (e: unknown) => console.error("[auth] get_primary_role failed", e),
        );
      } else {
        setRole(null);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setUser(data.session?.user ?? null);
        currentUserId = data.session?.user?.id ?? null;
        if (data.session?.user) {
          const userId = data.session.user.id;
          supabase.rpc("get_primary_role", { _user_id: userId }).then(
            ({ data: r }) => applyRole(userId, (r as string | null) ?? null),
            (e: unknown) => console.error("[auth] get_primary_role failed", e),
          );
        }
        setLoading(false);
      })
      .catch((e) => {
        console.error("[auth] getSession failed", e);
        setLoading(false);
      });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user, loading, role };
}
