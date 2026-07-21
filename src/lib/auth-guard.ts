import { redirect } from "@tanstack/react-router";

/**
 * Shared role guard for `beforeLoad` on `_authenticated/dashboard.*` routes.
 * Throws the same redirect every guard in the app already used by hand
 * (`redirect({ to: "/dashboard" })`) — centralizing it removes the risk of a
 * copy-pasted `!==` chain silently drifting between files (e.g. one guard
 * forgetting `super_admin`) and makes every remaining guard read as one line
 * stating exactly who may pass.
 */
export function requireRole(role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) {
    throw redirect({ to: "/dashboard" });
  }
}
