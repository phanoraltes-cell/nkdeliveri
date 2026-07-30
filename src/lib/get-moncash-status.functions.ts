import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only, read-only: exposes isMonCashConfigured() (a boolean, never a
 * secret value) to the MonCash admin dashboard so it can tell "not
 * activated in the database" (payment_providers.is_active) apart from
 * "not configured on the server" (the 5 MONCASH_* env vars) — two
 * independent gates that look identical from the payout form alone.
 */
export const getMonCashStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    const { isMonCashConfigured } = await import("@/lib/payment-providers/moncash-config.server");
    return { configured: isMonCashConfigured() };
  });
