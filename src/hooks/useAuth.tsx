import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: string | null;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Single app-wide subscription to Supabase auth state, mounted once in
 * __root.tsx. Previously this logic lived directly in useAuth() and ran
 * independently in every component that called it (site-header, bottom-nav,
 * checkout, orders, profile, useFavorites) — each mount meant its own
 * onAuthStateChange subscription, getSession() call, and get_primary_role
 * RPC. Centralizing it here means exactly one of each for the whole app;
 * consumers still call useAuth() with the same return shape as before.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
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

  return (
    <AuthContext.Provider value={{ session, user, loading, role }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
