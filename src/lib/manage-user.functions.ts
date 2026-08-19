import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ userId: z.string().uuid() });

/** Bans the target account indefinitely (GoTrue has no permanent-ban flag — 100 years is the accepted convention). */
export const suspendUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");
    if (data.userId === userId) throw new Error("Ou pa ka sispann pwòp kont ou");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Suspending another admin/super_admin requires super_admin — a plain
    // admin locking out another admin is the same privilege-escalation path
    // the role-management RPCs already guard against.
    const { data: targetRoles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    // Fail closed: if this lookup errors, targetRoles ?? [] would silently
    // read as "no elevated role", bypassing the super_admin-only check below
    // for an account that may well be an admin.
    if (rolesErr) throw new Error(rolesErr.message);
    const targetHasElevatedRole = (targetRoles ?? []).some(
      (r) => r.role === "admin" || r.role === "super_admin",
    );
    if (targetHasElevatedRole && !isSuperAdmin) {
      throw new Error("Sèl yon super_admin ka sispann yon lòt kont admin");
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "876000h",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AnonymizeInputSchema = z.object({
  customerId: z.string().uuid(),
  reason: z.string().optional(),
});

/**
 * NKD-020 — admin-triggered customer anonymization (docs/PHASE11_COMPLIANCE_
 * AUDIT.md, docs/NKD-020_CUSTOMER_ANONYMIZATION_REPORT.md). Two independent
 * steps, both required for a real "efasman":
 *   1. anonymize_customer_secure() (public schema, RLS/step-up enforced
 *      server-side) scrubs profiles/addresses/favorites/push_subscriptions —
 *      called through the CALLER's own session, same as suspendUserAccount's
 *      role checks below, so the RPC's own admin+STRICT-step-up guard is the
 *      real authorization boundary, not this function.
 *   2. auth.users itself: ban permanently (same 100-year convention as
 *      suspendUserAccount) AND scrub the signup metadata blob
 *      (raw_user_meta_data carries the original first_name/last_name/phone/
 *      address from signup — separate from, and just as identifying as,
 *      the profiles row) AND replace the email so it stops being personally
 *      identifying and frees the address up for reuse. This part can only
 *      go through the Admin API (service role), never plain SQL, matching
 *      every other GoTrue-touching operation already in this file.
 */
export const anonymizeCustomerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => AnonymizeInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    // Scrubs profiles/addresses/favorites/push_subscriptions and enforces
    // its own admin + STRICT step-up + customer-only-role checks — a
    // failure here (e.g. step-up not fresh, or the target has another
    // role) must abort before any auth.users mutation below.
    const { error: rpcErr } = await supabase.rpc("anonymize_customer_secure", {
      _customer_id: data.customerId,
      _reason: data.reason,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(data.customerId, {
      ban_duration: "876000h",
      email: `deleted-${data.customerId}@nkdeliveri.invalid`,
      user_metadata: {},
    });
    if (authErr) throw new Error(authErr.message);
    return { ok: true };
  });

export const reactivateUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "none",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
