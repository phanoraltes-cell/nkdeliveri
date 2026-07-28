import { type ReactNode, useEffect, useState } from "react";
import { ShieldAlert, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/utils";

/** Easily configurable per the request — minutes of inactivity before an admin's dashboard locks. */
export const ADMIN_IDLE_TIMEOUT_MINUTES = 20;

const IDLE_UNLOCK_FLAG = "nk_admin_idle_unlock_pending";

/**
 * Wraps every /dashboard/admin/* route (mounted once, in dashboard.admin.tsx's
 * layout) and locks the screen after ADMIN_IDLE_TIMEOUT_MINUTES of no mouse/
 * keyboard/touch/scroll activity — admins alone handle payments,
 * décaissements, refunds, disputes, user management, and commissions, per
 * the request. Other roles never mount this component at all, so they're
 * never affected.
 *
 * This locks the *screen*, not the session: the underlying Supabase session
 * is left completely alone (no signOut call) — an idle admin never loses
 * unsaved work or gets bounced out of the app, they just have to prove
 * their identity again before seeing the dashboard's content, same
 * "resume screen" pattern as a banking app's PIN re-entry.
 */
export function AdminIdleLock({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = !!user?.app_metadata?.providers?.includes?.("email");

  useIdleTimer(ADMIN_IDLE_TIMEOUT_MINUTES * 60 * 1000, () => setLocked(true), !!user);

  // Returning from the Google redirect this component itself triggered.
  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(IDLE_UNLOCK_FLAG) !== "1") return;
    sessionStorage.removeItem(IDLE_UNLOCK_FLAG);
    setLocked(false);
    toast.success("Sesyon admin ou debloke.");
  }, [user]);

  async function unlockWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    setSubmitting(false);
    if (err) {
      setError("Modpas la pa kòrèk.");
      return;
    }
    setPassword("");
    setLocked(false);
  }

  async function unlockWithOAuth() {
    sessionStorage.setItem(IDLE_UNLOCK_FLAG, "1");
    const provider = (user?.app_metadata?.provider as "google" | undefined) ?? "google";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
    if (err) {
      sessionStorage.removeItem(IDLE_UNLOCK_FLAG);
      toast.error(err.message);
    }
  }

  if (!locked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-brand-deep" />
          <h1 className="font-display text-lg font-extrabold text-ink">Sesyon admin bloke</h1>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Pou pwoteje done sansib yo (peman, dekesman, itilizatè), sesyon admin ou bloke apre{" "}
          {ADMIN_IDLE_TIMEOUT_MINUTES} minit san aktivite. Konfime idantite w pou kontinye.
        </p>

        {hasPassword ? (
          <form onSubmit={unlockWithPassword} className="space-y-3">
            <input
              type="password"
              autoFocus
              required
              placeholder="Modpas ou"
              aria-label="Modpas ou"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls()}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting || !password} className="w-full">
              {submitting ? "Ap verifye…" : "Debloke"}
            </Button>
          </form>
        ) : (
          <Button type="button" onClick={unlockWithOAuth} className="w-full">
            Kontinye ak Google
          </Button>
        )}

        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-brand-deep"
        >
          <LogOut className="h-3.5 w-3.5" /> Oswa dekonekte nèt
        </button>
      </div>
    </div>
  );
}
