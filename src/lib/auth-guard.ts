import { redirect } from "@tanstack/react-router";

/**
 * Shared role guard for `beforeLoad` on `_authenticated/dashboard.*` routes.
 * Throws the same redirect every guard in the app already used by hand
 * (`redirect({ to: "/dashboard" })`) — centralizing it removes the risk of a
 * copy-pasted `!==` chain silently drifting between files (e.g. one guard
 * forgetting `super_admin`) and makes every remaining guard read as one line
 * stating exactly who may pass.
 *
 * Takes the caller's *full* role list (`context.allRoles`), not just their
 * single highest-priority role — a user with more than one role (e.g. a
 * restaurant_staff account that's also a customer) must be admitted into
 * every dashboard family they actually hold, not only the top-priority one.
 */
export function requireRole(roles: readonly string[], allowed: readonly string[]): void {
  if (!allowed.some((r) => roles.includes(r))) {
    throw redirect({ to: "/dashboard" });
  }
}
