import { type ReactNode, useEffect, useState } from "react";
import { ShieldAlert, LogOut, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { useTotpFactor } from "@/hooks/useTotpFactor";
import { logStepUpEvent } from "@/lib/admin-step-up";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/utils";

/** Easily configurable per the request — minutes of inactivity before an admin's dashboard locks. */
export const ADMIN_IDLE_TIMEOUT_MINUTES = 20;

const IDLE_UNLOCK_FLAG = "nk_admin_idle_unlock_pending";

/**
 * Wraps every /dashboard/admin/* route (mounted once, in dashboard.admin.tsx's
 * layout). Two independent reasons to show the lock screen, both landing on
 * the exact same UI:
 *
 *   1. Idle timeout — locks after ADMIN_IDLE_TIMEOUT_MINUTES of no mouse/
 *      keyboard/touch/scroll activity (unchanged from the original
 *      session-hardening request).
 *   2. Step-up gate at dashboard entry (Phase 2,
 *      docs/ADMIN_ACCESS_SECURITY_AUDIT.md §9-10) — on mount, asks the
 *      server (check_admin_step_up_secure(), same "standard" tier used
 *      elsewhere) whether this session already has a valid recent
 *      step-up. If not, starts locked immediately, even on a completely
 *      fresh page load. This is a *UX* gate only — read-only admin RPCs
 *      are NOT individually enforced server-side (deliberate scope
 *      decision, see the migration's own header comment); the real
 *      server-side boundary this closes is on the *mutating* RPCs
 *      (add_user_role_secure etc.), which now check the same freshness
 *      independently of whatever this component believes.
 *
 * This locks the *screen*, not the session: the underlying Supabase
 * session is left completely alone (no signOut call) — an idle/fresh
 * admin never loses unsaved work or gets bounced out of the app, they
 * just have to prove their identity again before seeing the dashboard's
 * content, same "resume screen" pattern as a banking app's PIN re-entry.
 *
 * Unlock prefers a real TOTP challenge when the account has one enrolled
 * (the same private.admin_step_up_status() the server checks); falls back
 * to password/OAuth re-entry for accounts with none yet.
 */
export function AdminIdleLock({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const totp = useTotpFactor();
  const [locked, setLocked] = useState(false);
  const [checkingGate, setCheckingGate] = useState(true);
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = !!user?.app_metadata?.providers?.includes?.("email");

  useIdleTimer(ADMIN_IDLE_TIMEOUT_MINUTES * 60 * 1000, () => setLocked(true), !!user);

  // Step-up gate at entry — runs once per mount of the admin layout (i.e.
  // once per navigation into /dashboard/admin from outside it, and again
  // on a hard refresh), not on every route change within it.
  useEffect(() => {
    if (!user) {
      setCheckingGate(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("check_admin_step_up_secure");
        if (cancelled) return;
        if (error) {
          console.error("[AdminIdleLock] check_admin_step_up_secure failed", error);
          setLocked(true); // fail closed
        } else {
          setLocked(!data);
        }
      } finally {
        if (!cancelled) setCheckingGate(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run for a genuinely different user
  }, [user?.id]);

  // Returning from the Google redirect this component itself triggered.
  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(IDLE_UNLOCK_FLAG) !== "1") return;
    sessionStorage.removeItem(IDLE_UNLOCK_FLAG);
    setLocked(false);
    void logStepUpEvent("admin_step_up_success");
    toast.success("Sesyon admin ou debloke.");
  }, [user]);

  async function unlockWithTotp(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await totp.challenge(totpCode);
      void logStepUpEvent("admin_step_up_success");
      setTotpCode("");
      setLocked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kòd la pa kòrèk.");
    } finally {
      setSubmitting(false);
    }
  }

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
    void logStepUpEvent("admin_step_up_success");
    setPassword("");
    setLocked(false);
  }

  async function unlockWithOAuth() {
    sessionStorage.setItem(IDLE_UNLOCK_FLAG, "1");
    const provider = (user?.app_metadata?.provider as "google" | undefined) ?? "google";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.href,
        // See useReauth.ts's identical comment: without this, an already
        // logged-in browser can complete the redirect with zero user
        // interaction, proving nothing.
        queryParams: { prompt: "consent" },
      },
    });
    if (err) {
      sessionStorage.removeItem(IDLE_UNLOCK_FLAG);
      toast.error(err.message);
    }
  }

  if (checkingGate) return null; // avoid a locked-screen flash while the very first check is in flight
  if (!locked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-brand-deep" />
          <h1 className="font-display text-lg font-extrabold text-ink">Verifikasyon sekirite</h1>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Kont ou gen privilèj administratif — nou bezwen yon verifikasyon adisyonèl anvan w antre
          nan espas administrasyon an, oswa apre {ADMIN_IDLE_TIMEOUT_MINUTES} minit san aktivite.
        </p>

        {totp.checking ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : totp.hasVerifiedFactor ? (
          <form onSubmit={unlockWithTotp} className="space-y-3">
            <p className="flex items-center gap-2 text-xs text-ink-soft">
              <KeyRound className="h-3.5 w-3.5 shrink-0" /> Kòd aplikasyon otantifikasyon ou an
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              placeholder="000000"
              aria-label="Kòd verifikasyon"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputCls() + " text-center text-lg tracking-[0.5em]"}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting || totpCode.length !== 6} className="w-full">
              {submitting ? "Ap verifye…" : "Debloke"}
            </Button>
          </form>
        ) : hasPassword ? (
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

        {!totp.checking && !totp.hasVerifiedFactor && (
          <p className="mt-3 text-center text-[11px] text-ink-soft">
            <a
              href="/dashboard/admin/security"
              className="font-bold text-brand-deep underline underline-offset-2"
            >
              Aktive verifikasyon an de etap
            </a>{" "}
            pou yon pwoteksyon pi fò.
          </p>
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
