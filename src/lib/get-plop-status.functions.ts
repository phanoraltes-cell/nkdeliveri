import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only, read-only: exposes isPlopConfigured() (a boolean, never a
 * secret value) to the admin "Peman Otomatik" monitoring dashboard so it
 * can tell "not activated in the database" (payment_provider_settings.
 * moncash_auto/natcash_auto.enabled) apart from "not configured on the
 * server" (the PLOP_* env vars) — two independent gates that look
 * identical from the checkout page alone. Same pattern as
 * get-moncash-status.functions.ts. Shared by both the MonCash Otomatik
 * and NatCash Otomatik tabs — both are backed by the same PLOP gateway,
 * so there is only one "configured" answer for both.
 */
export const getPlopStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    const { isPlopConfigured } = await import("@/lib/payment-providers/plop-config.server");
    return { configured: isPlopConfigured() };
  });
