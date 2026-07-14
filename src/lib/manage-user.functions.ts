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
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
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
