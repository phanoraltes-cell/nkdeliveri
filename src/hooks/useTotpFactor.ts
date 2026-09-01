import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Thin wrapper around Supabase's own native MFA API
 * (docs/archive/audits/ADMIN_ACCESS_SECURITY_AUDIT.md §8/§9, docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md) —
 * `supabase.auth.mfa.*` is the entire mechanism; nothing here stores a
 * secret, generates a code, or re-implements TOTP. Shared by
 * `useReauth`/`ReauthDialog` (step-up on a specific sensitive action) and
 * `AdminIdleLock` (step-up gate on dashboard entry / after inactivity) so
 * the enroll/challenge flow exists in exactly one place.
 *
 * Enrollment is independent of the account's primary sign-in method —
 * works identically for password and Google-OAuth-only accounts (the
 * real admin account on this project today is OAuth-only, confirmed
 * before this was built), since MFA factors live on the user, not on a
 * specific auth provider.
 */
export function useTotpFactor() {
  const [checking, setChecking] = useState(true);
  const [hasVerifiedFactor, setHasVerifiedFactor] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp.find((f) => f.status === "verified") ?? null;
      setHasVerifiedFactor(!!verified);
      setFactorId(verified?.id ?? null);
    } catch (e) {
      console.error("[useTotpFactor] listFactors failed", e);
      // Fail closed for the *enrollment* prompt only — this hook never
      // makes a security decision itself (that's always the server-side
      // require_admin_step_up[_strict]() inside each guarded RPC), so a
      // failed check here just means "don't claim they have a factor",
      // never "let them through".
      setHasVerifiedFactor(false);
      setFactorId(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Starts enrollment — returns the QR/secret to render, caller collects a code and calls verifyEnrollment. */
  async function startEnrollment() {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `nkdeliveri-admin-${Date.now()}`,
    });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  /** Completes enrollment: challenge + verify in one step (matches Supabase's own combined helper). */
  async function verifyEnrollment(pendingFactorId: string, code: string) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId,
      code,
    });
    if (error) throw error;
    await refresh();
  }

  /** Challenges an already-verified factor (the normal step-up path once enrolled). */
  async function challenge(code: string) {
    if (!factorId) throw new Error("Pa gen okenn faktè TOTP verifye");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  }

  return {
    checking,
    hasVerifiedFactor,
    factorId,
    refresh,
    startEnrollment,
    verifyEnrollment,
    challenge,
  };
}
