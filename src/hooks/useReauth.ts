import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTotpFactor } from "@/hooks/useTotpFactor";
import { useBackupCodes } from "@/hooks/useBackupCodes";
import { logStepUpEvent } from "@/lib/admin-step-up";

export { isStepUpError } from "@/lib/admin-step-up";

/** Matches the two tiers wired server-side (20260811120000_admin_step_up_enforcement.sql). */
export type StepUpTier = "standard" | "strict";

const GRACE_PERIOD_MS: Record<StepUpTier, number> = {
  // Kept aligned with the server's own windows (private.require_admin_step_up
  // = 15 min, require_admin_step_up_strict = 5 min) so the dialog almost
  // never shows *more* than the server would actually require — an
  // over-optimistic client just means an extra round-trip that fails with
  // STEP_UP_REQUIRED and gets recovered from (see isStepUpError below),
  // never a security gap, since the server re-checks independently every
  // time regardless of what this timer believes.
  standard: 15 * 60 * 1000,
  strict: 5 * 60 * 1000,
};
const OAUTH_REAUTH_FLAG = "nk_reauth_pending";

/**
 * Step-up re-authentication for sensitive admin/financial actions (Phase 4
 * of the original session-hardening request; hardened in Phase 2 of
 * docs/ADMIN_ACCESS_SECURITY_AUDIT.md). Until 2026-08-11 this dialog was
 * the *entire* protection — the RPC it guarded never verified anything
 * server-side, so a stolen session's JWT could call e.g.
 * add_user_role_secure directly and skip this dialog completely. That's
 * now fixed at the RPC layer (private.require_admin_step_up[_strict](),
 * checked independently of whatever this hook believes) — this hook is
 * UX now, not the security boundary, but it still matters: without it,
 * every guarded action would fail once and show a raw server error
 * instead of a real re-auth prompt.
 *
 * Prefers a real MFA (TOTP) challenge when the account has one enrolled
 * — the only proof the server accepts for `tier: "strict"` actions.
 * Falls back to password/OAuth re-entry (unchanged flow) for accounts
 * with no TOTP factor yet — accepted server-side only for `tier:
 * "standard"` actions; a strict-tier RPC call will still be rejected
 * server-side until the account enrolls, by design (see the migration's
 * own header comment).
 *
 * Password accounts: the dialog collects the current password, calls
 * signInWithPassword, and on success runs the guarded action immediately.
 *
 * OAuth-only accounts (the one real admin account on this project today
 * is Google-only) redirect through Google and back; `prompt: "consent"`
 * is now passed explicitly (previously omitted — a real navigator with an
 * already-active Google session could complete this redirect with zero
 * user interaction, silently defeating the whole point of asking again;
 * flagged as R3 in the audit). On return, a grace window opens instead of
 * resuming the exact original click (a JS closure can't survive a full
 * navigation) — the admin clicks the original action once more.
 */
export function useReauth() {
  const { user } = useAuth();
  const totp = useTotpFactor();
  const backup = useBackupCodes();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"totp" | "backup" | "password" | "oauth">("password");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifiedUntilRef = useRef<Partial<Record<StepUpTier, number>>>({});
  const pendingActionRef = useRef<(() => void) | null>(null);
  const pendingTierRef = useRef<StepUpTier>("standard");

  const hasPassword = !!user?.app_metadata?.providers?.includes?.("email");

  // Priority: TOTP (strongest, satisfies both tiers) > backup codes (only
  // ever satisfies "standard" server-side, see confirmBackup below) >
  // password > OAuth. Backup codes never take priority over TOTP when both
  // exist -- switchToBackup() below is how an admin opts into it instead.
  useEffect(() => {
    if (totp.checking || backup.checking) return;
    setMode(
      totp.hasVerifiedFactor
        ? "totp"
        : backup.hasCodes
          ? "backup"
          : hasPassword
            ? "password"
            : "oauth",
    );
  }, [totp.checking, totp.hasVerifiedFactor, backup.checking, backup.hasCodes, hasPassword]);

  // Returning from the Google redirect this hook itself triggered.
  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(OAUTH_REAUTH_FLAG) !== "1") return;
    sessionStorage.removeItem(OAUTH_REAUTH_FLAG);
    // OAuth fallback only ever satisfies the standard tier server-side
    // (require_admin_step_up_strict() never accepts it) — mirror that
    // here so the dialog re-opens immediately if the pending action was
    // strict, instead of optimistically believing a tier it can't grant.
    verifiedUntilRef.current.standard = Date.now() + GRACE_PERIOD_MS.standard;
    toast.success("Idantite konfime — ou ka kontinye aksyon an pou 5 minit.");
  }, [user]);

  const isVerified = useCallback((tier: StepUpTier) => {
    const until = verifiedUntilRef.current[tier];
    return !!until && Date.now() < until;
  }, []);

  /** Wrap a sensitive action: runs it immediately if a valid step-up is already on record for this tier, otherwise prompts first. */
  const withReauth = useCallback(
    (action: () => void, tier: StepUpTier = "standard") => {
      if (isVerified(tier) || (tier === "standard" && isVerified("strict"))) {
        action();
        return;
      }
      pendingActionRef.current = action;
      pendingTierRef.current = tier;
      setError(null);
      setPassword("");
      setTotpCode("");
      setBackupCode("");
      setDialogOpen(true);
      void logStepUpEvent("admin_step_up_started");
    },
    [isVerified],
  );

  /** Call from a mutation's onError when isStepUpError(e) — invalidates the stale local grace window so the very next click re-prompts instead of failing the same way again. */
  const invalidateStepUp = useCallback((tier: StepUpTier = "standard") => {
    delete verifiedUntilRef.current[tier];
    if (tier === "standard") delete verifiedUntilRef.current.strict;
  }, []);

  function markVerified(tier: StepUpTier) {
    verifiedUntilRef.current[tier] = Date.now() + GRACE_PERIOD_MS[tier];
    // A strict verification also satisfies any pending standard-tier action.
    if (tier === "strict")
      verifiedUntilRef.current.standard = Date.now() + GRACE_PERIOD_MS.standard;
  }

  function runPending() {
    setDialogOpen(false);
    setPassword("");
    setTotpCode("");
    setBackupCode("");
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }

  async function confirmTotp() {
    setSubmitting(true);
    setError(null);
    try {
      await totp.challenge(totpCode);
      void logStepUpEvent("admin_step_up_success");
      markVerified(pendingTierRef.current);
      runPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kòd la pa kòrèk.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmBackup() {
    setSubmitting(true);
    setError(null);
    try {
      await backup.verify(backupCode);
      void logStepUpEvent("admin_step_up_success");
      // Backup codes only ever satisfy "standard" server-side
      // (private.admin_step_up_status() rejects them for the STRICT/
      // _allow_fallback=false path by design) -- mirror that here exactly
      // like the password/OAuth fallback below already does, so a
      // pending STRICT action still correctly re-prompts (via
      // isStepUpError/invalidateStepUp) instead of appearing to succeed.
      markVerified("standard");
      runPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kòd sekou pa valid.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmPassword() {
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
    // Password/OAuth fallback only ever satisfies "standard" server-side.
    markVerified("standard");
    runPending();
  }

  async function continueWithOAuth() {
    sessionStorage.setItem(OAUTH_REAUTH_FLAG, "1");
    const provider = (user?.app_metadata?.provider as "google" | undefined) ?? "google";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.href,
        // Forces a real interactive prompt even if the browser still has
        // an active Google session — without this, Google can complete
        // the redirect silently with zero user interaction, which would
        // make this "re-authentication" step prove nothing beyond "the
        // browser is still open" (audit finding R3).
        queryParams: { prompt: "consent" },
      },
    });
    if (err) {
      sessionStorage.removeItem(OAUTH_REAUTH_FLAG);
      toast.error(err.message);
    }
    // On success the browser navigates away — nothing left to do here.
  }

  return {
    withReauth,
    invalidateStepUp,
    dialogState: {
      open: dialogOpen,
      setOpen: setDialogOpen,
      mode,
      hasPassword,
      hasVerifiedFactor: totp.hasVerifiedFactor,
      hasBackupCodes: backup.hasCodes,
      checkingFactor: totp.checking || backup.checking,
      password,
      setPassword,
      totpCode,
      setTotpCode,
      backupCode,
      setBackupCode,
      submitting,
      error,
      confirmTotp,
      confirmBackup,
      confirmPassword,
      continueWithOAuth,
      switchToFallback: () => setMode(hasPassword ? "password" : "oauth"),
      switchToTotp: () => setMode("totp"),
      switchToBackup: () => setMode("backup"),
    },
  };
}
