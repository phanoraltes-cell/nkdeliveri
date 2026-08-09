import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only, read-only: exposes isStripeConfigured() (a boolean, never a
 * secret value) to the admin "Peman Otomatik" monitoring dashboard's Kat
 * Kredi tab — same pattern as get-moncash-status.functions.ts/
 * get-plop-status.functions.ts.
 */
export const getStripeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    const { isStripeConfigured } = await import("@/lib/payment-providers/stripe-config.server");
    return { configured: isStripeConfigured() };
  });
