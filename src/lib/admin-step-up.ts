import { supabase } from "@/integrations/supabase/client";

/**
 * Shared by useReauth.ts and admin-idle-lock.tsx — kept in one place so
 * the two step-up surfaces (action-level and dashboard-entry-level) never
 * drift on what counts as a step-up error or how telemetry gets logged
 * (docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md).
 */

/** True for the error an RPC raises when private.require_admin_step_up[_strict]() rejects the call. */
export function isStepUpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("STEP_UP_REQUIRED");
}

/**
 * Mesaj kòrèk pou yon erè step-up — DISTENGE 2 ka ki pa menm ditou:
 *
 *   STEP_UP_REQUIRED      (tier standard) -> verifikasyon an ekspire
 *                          vre; re-klike epi konfime = sa mache.
 *   STEP_UP_REQUIRED_MFA  (tier strict)   -> sèl yon kòd TOTP ka pase.
 *                          Si kont lan pa gen okenn faktè TOTP anrejistre,
 *                          RE-KLIKE P AP JANM MACHE (modpas/OAuth/kòd
 *                          sekou pa janm satisfè tier strict la —
 *                          20260811120000_admin_step_up_enforcement.sql).
 *
 * Anvan sa, tou de ka yo t ap montre "Verifikasyon sekirite ekspire —
 * klike ankò", ki voye yon admin san TOTP nan yon bouk san sòti.
 */
export function stepUpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("STEP_UP_REQUIRED_MFA")) {
    return "Aksyon sa a mande yon kòd otantifikasyon (TOTP). Aktive verifikasyon an de etap nan Sekirite kont, apre sa eseye ankò.";
  }
  return "Verifikasyon sekirite ekspire — klike ankò pou re-verifye.";
}

export type StepUpTelemetryEvent =
  | "admin_step_up_started"
  | "admin_step_up_success"
  | "admin_step_up_failed"
  | "admin_step_up_expired";

/**
 * Best-effort audit telemetry — never the security decision itself (that's
 * always the server-side private.require_admin_step_up[_strict](),
 * evaluated independently inside each guarded RPC). Made as a *separate*
 * RPC call deliberately: logging a failure from inside the guarded RPC's
 * own transaction is a no-op (a RAISE EXCEPTION rolls back everything
 * written earlier in that same transaction, including an audit_log
 * INSERT) — see the migration's own comment on
 * private.require_admin_step_up().
 */
export async function logStepUpEvent(action: StepUpTelemetryEvent): Promise<void> {
  try {
    await supabase.rpc("log_admin_step_up_event_secure", { _action: action });
  } catch (e) {
    console.error("[admin-step-up] log_admin_step_up_event_secure failed", e);
  }
}

export async function logDashboardAccessDenied(): Promise<void> {
  try {
    await supabase.rpc("log_dashboard_access_denied_secure");
  } catch (e) {
    console.error("[admin-step-up] log_dashboard_access_denied_secure failed", e);
  }
}
