import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const GRACE_PERIOD_MS = 5 * 60 * 1000;
const OAUTH_REAUTH_FLAG = "nk_reauth_pending";

/**
 * Step-up re-authentication for sensitive admin/financial actions (Phase 4
 * of the session-hardening request) — proves the caller still knows their
 * credentials before letting a guarded action run, even with an otherwise
 * still-valid session. Uses only official Supabase Auth calls
 * (signInWithPassword / signInWithOAuth), never a parallel auth system.
 *
 * Password accounts: the dialog collects the current password, calls
 * signInWithPassword, and on success runs the guarded action immediately —
 * a single click, no navigation.
 *
 * OAuth-only accounts (the one real admin account on this project today is
 * Google-only, confirmed by inspecting auth.identities before building
 * this — see the accompanying report) can't do that synchronously:
 * signInWithOAuth always leaves the page. Continuing here redirects
 * through Google and back; on return, a 5-minute "verified" grace window
 * opens instead of trying to resume the exact original click (a JS
 * closure can't survive a full navigation) — the admin clicks the
 * original action once more, which now passes immediately. One extra
 * click, explained in the dialog copy, instead of a fragile resume system.
 */
export function useReauth() {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifiedUntilRef = useRef<number | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const hasPassword = !!user?.app_metadata?.providers?.includes?.("email");

  // Returning from the Google redirect this hook itself triggered — open
  // a grace window instead of trying to resume whatever was clicked
  // before leaving.
  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(OAUTH_REAUTH_FLAG) !== "1") return;
    sessionStorage.removeItem(OAUTH_REAUTH_FLAG);
    verifiedUntilRef.current = Date.now() + GRACE_PERIOD_MS;
    toast.success("Idantite konfime — ou ka kontinye aksyon an pou 5 minit.");
  }, [user]);

  const isVerified = useCallback(
    () => !!verifiedUntilRef.current && Date.now() < verifiedUntilRef.current,
    [],
  );

  /** Wrap a sensitive action: runs it immediately if still within the grace window, otherwise prompts first. */
  const withReauth = useCallback(
    (action: () => void) => {
      if (isVerified()) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setError(null);
      setPassword("");
      setDialogOpen(true);
    },
    [isVerified],
  );

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
    verifiedUntilRef.current = Date.now() + GRACE_PERIOD_MS;
    setDialogOpen(false);
    setPassword("");
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }

  async function continueWithOAuth() {
    sessionStorage.setItem(OAUTH_REAUTH_FLAG, "1");
    const provider = (user?.app_metadata?.provider as "google" | undefined) ?? "google";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
    if (err) {
      sessionStorage.removeItem(OAUTH_REAUTH_FLAG);
      toast.error(err.message);
    }
    // On success the browser navigates away — nothing left to do here.
  }

  return {
    withReauth,
    dialogState: {
      open: dialogOpen,
      setOpen: setDialogOpen,
      hasPassword,
      password,
      setPassword,
      submitting,
      error,
      confirmPassword,
      continueWithOAuth,
    },
  };
}
