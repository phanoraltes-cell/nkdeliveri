import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        supabase.rpc("get_primary_role", { _user_id: s.user.id }).then(({ data }) => {
          setRole((data as string | null) ?? null);
        });
      } else {
        setRole(null);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        supabase.rpc("get_primary_role", { _user_id: data.session.user.id }).then(({ data: r }) => {
          setRole((r as string | null) ?? null);
        });
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user, loading, role };
}