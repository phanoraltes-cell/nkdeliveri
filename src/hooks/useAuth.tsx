import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Single highest-priority role (super_admin > admin > restaurant_owner >
   * restaurant_staff > driver > customer) — kept for existing/simple call
   * sites, but genuinely single-role: a multi-role account (e.g. a
   * restaurant_staff account that's also a customer) only ever appears as
   * whichever role sorts highest here. Prefer `allRoles` for any check
   * that decides whether a user is *permitted* to do something — `role`
   * alone under-reports what they actually hold. (No current consumer of
   * this hook reads `role` for an authorization decision — grepped before
   * this comment was written — but the field stays for the ones that read
   * it for display/labeling, so `allRoles` is added here rather than
   * removing it.) */
  role: string | null;
  /** Every role this account actually holds, unordered. See `role` above. */
  allRoles: string[];
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Single app-wide subscription to Supabase auth state, mounted once in
 * __root.tsx (inside QueryClientProvider, so it can invalidate the router/
 * query cache itself). Previously this logic lived directly in useAuth()
 * and ran independently in every component that called it (site-header,
 * bottom-nav, checkout, orders, profile, useFavorites) — each mount meant
 * its own onAuthStateChange subscription, getSession() call, and
 * get_primary_role RPC. RootComponent also had its own separate
 * onAuthStateChange subscription just to invalidate the router/query cache
 * on sign-in/out — that's folded in here too, so there is exactly one
 * subscription for the whole app. Consumers still call useAuth() with the
 * same return shape as before.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session AND
    // getSession() below resolves independently — both can kick off a
    // get_primary_role RPC (+ user_roles select) for the same or a
    // different user. currentUserId guards against the slower one winning
    // and overwriting `role`/`allRoles` with a stale value (e.g. sign-out
    // then sign back in as another account before the first call returns).
    let currentUserId: string | null = null;

    function applyRole(forUserId: string, roleResult: string | null) {
      if (forUserId === currentUserId) setRole(roleResult);
    }
    function applyAllRoles(forUserId: string, rows: { role: string }[]) {
      if (forUserId === currentUserId) setAllRoles(rows.map((r) => r.role));
    }

    function loadRoles(userId: string) {
      // .rpc()/.from() return a PostgrestBuilder, which is thenable but not
      // a real Promise (no .catch()) — use the two-arg .then(ok, err) form.
      supabase.rpc("get_primary_role", { _user_id: userId }).then(
        ({ data }) => applyRole(userId, (data as string | null) ?? null),
        (e: unknown) => console.error("[auth] get_primary_role failed", e),
      );
      // user_roles RLS already grants self-select (see
      // _authenticated/route.tsx's own beforeLoad, which reads this exact
      // table the same way) — no RPC needed for "list my own roles".
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .then(
          ({ data, error }) => {
            if (error) {
              console.error("[auth] user_roles fetch failed", error);
              return;
            }
            applyAllRoles(userId, (data ?? []) as { role: string }[]);
          },
          (e: unknown) => console.error("[auth] user_roles fetch failed", e),
        );
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      currentUserId = s?.user?.id ?? null;
      if (s?.user) {
        loadRoles(s.user.id);
      } else {
        setRole(null);
        setAllRoles([]);
      }

      // Formerly RootComponent's own separate onAuthStateChange subscription
      // — merged in here so the app has exactly one.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setUser(data.session?.user ?? null);
        currentUserId = data.session?.user?.id ?? null;
        if (data.session?.user) {
          loadRoles(data.session.user.id);
        }
        setLoading(false);
      })
      .catch((e) => {
        console.error("[auth] getSession failed", e);
        setLoading(false);
      });
    return () => sub.subscription.unsubscribe();
    // router/queryClient are stable singleton instances (one router, one
    // QueryClient for the whole app) — including them here matches
    // RootComponent's old effect exactly without ever actually re-running
    // this effect in practice.
  }, [router, queryClient]);

  return (
    <AuthContext.Provider value={{ session, user, loading, role, allRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
