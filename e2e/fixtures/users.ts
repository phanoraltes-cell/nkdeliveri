// Fixed (not random) UUIDs so specs across different files can
// cross-reference the same fixture entities (e.g. the order created in
// checkout-cash.spec.ts is the same order cancelled in
// order-lifecycle-customer.spec.ts and disputed in admin/disputes.spec.ts)
// without importing across spec files.

export const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111111";
export const RESTAURANT_OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
export const DRIVER_USER_ID = "33333333-3333-4333-8333-333333333333";
export const ADMIN_USER_ID = "44444444-4444-4444-8444-444444444444";

export type FixtureRole = "customer" | "restaurant_owner" | "driver" | "admin";

export const ROLE_USER_ID: Record<FixtureRole, string> = {
  customer: CUSTOMER_USER_ID,
  restaurant_owner: RESTAURANT_OWNER_USER_ID,
  driver: DRIVER_USER_ID,
  admin: ADMIN_USER_ID,
};

export const ROLE_EMAIL: Record<FixtureRole, string> = {
  customer: "customer@e2e.test",
  restaurant_owner: "restaurant@e2e.test",
  driver: "driver@e2e.test",
  admin: "admin@e2e.test",
};

/**
 * Matches the exact Session shape supabase-js persists verbatim to
 * localStorage (no wrapper object) — confirmed by reading the installed
 * @supabase/auth-js source this session. `app_metadata.providers`
 * includes "email" for every fixture user so `useReauth()`'s
 * `hasPassword` check is true — the admin payout re-auth dialog collects
 * a password and calls signInWithPassword again rather than redirecting
 * through Google OAuth, which can't be driven headlessly.
 */
export function buildSession(role: FixtureRole) {
  const userId = ROLE_USER_ID[role];
  const email = ROLE_EMAIL[role];
  const now = new Date().toISOString();
  return {
    access_token: `e2e-fake-access-token-${role}`,
    refresh_token: `e2e-fake-refresh-token-${role}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 9_999_999_999,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: now,
      confirmed_at: now,
      email_confirmed_at: now,
      last_sign_in_at: now,
      updated_at: now,
      identities: [],
      is_anonymous: false,
    },
  };
}

/** `get_primary_role` RPC response shape — a bare string. */
export const PRIMARY_ROLE: Record<FixtureRole, string> = {
  customer: "customer",
  restaurant_owner: "restaurant_owner",
  driver: "driver",
  admin: "admin",
};

/** `user_roles` table select response shape — array of {role}. */
export function userRolesRows(role: FixtureRole): { role: string }[] {
  return [{ role: PRIMARY_ROLE[role] }];
}
