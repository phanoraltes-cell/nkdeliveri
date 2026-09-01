import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin backup/recovery codes — a second, independent step-up option
 * alongside TOTP (docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md's
 * companion module, supabase/migrations/20260813100000_admin_backup_codes.sql).
 * Unlike TOTP, this is entirely custom (Supabase Auth has no native
 * "recovery code" factor type) — codes are generated/verified via our own
 * SECURITY DEFINER RPCs, hashed server-side, never stored in plaintext.
 * Only ever satisfies the STANDARD step-up tier server-side (never
 * STRICT — see the migration's own header for the reasoning), same shape
 * as useTotpFactor.ts so the two can be used interchangeably by
 * useReauth/AdminIdleLock.
 */
export function useBackupCodes() {
  const [checking, setChecking] = useState(true);
  const [codesRemaining, setCodesRemaining] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc("get_admin_backup_codes_status_secure");
      if (error) throw error;
      const row = data?.[0];
      setCodesRemaining(row?.codes_remaining ?? 0);
      setGeneratedAt(row?.generated_at ?? null);
      setLastUsedAt(row?.last_used_at ?? null);
    } catch (e) {
      console.error("[useBackupCodes] status check failed", e);
      // Same fail-closed posture as useTotpFactor -- this hook never makes
      // the security decision itself (that's private.admin_step_up_status()
      // server-side), a failed check here just means "don't claim codes exist".
      setCodesRemaining(0);
      setGeneratedAt(null);
      setLastUsedAt(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasCodes = codesRemaining > 0;

  /** (Re)generates 10 fresh codes, invalidating any previous unused ones. Returns the plaintext codes ONE TIME ONLY -- never persisted, never retrievable again after this call returns. */
  async function generate(): Promise<string[]> {
    const { data, error } = await supabase.rpc("generate_admin_backup_codes_secure");
    if (error) throw error;
    await refresh();
    return data ?? [];
  }

  /** Consumes one code. Throws on a wrong/already-used/malformed code (the RPC returns false rather than an error for that specific case -- see its own comment -- this just normalizes it back into a throw for callers). */
  async function verify(code: string): Promise<void> {
    const { data, error } = await supabase.rpc("verify_admin_backup_code_secure", { _code: code });
    if (error) throw error;
    if (!data) throw new Error("Kòd sekou pa valid.");
    await refresh();
  }

  return {
    checking,
    hasCodes,
    codesRemaining,
    generatedAt,
    lastUsedAt,
    refresh,
    generate,
    verify,
  };
}
