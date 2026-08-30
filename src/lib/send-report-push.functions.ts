import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";
import { smsFallback } from "@/lib/sms-dispatch.server";

const ReportIdSchema = z.object({ reportId: z.string().uuid() });

/**
 * TACH 2 — kanal pou evènman siyalman yo (Tach 1 te kreye ranje
 * `notifications` an — in-app + Realtime — men te eksplisitman kite "ki
 * kanal" pou Tach 2, wè migrasyon 20260830140000). Push SÈLMAN bay admin
 * yo: pa gen okenn done sansib nan kò mesaj la (jamè non/kontak kliyan
 * an), menm si dosye a poko pataje ak sib la.
 */
export const sendReportOpenedPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ReportIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!(await enforceRateLimit(context.supabase, "send_report_opened_push", 20, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .select("id, order_id, target_type, reason_code, orders(order_number)")
      .eq("id", data.reportId)
      .single();
    if (error || !report) throw new Error(error?.message || "Report not found");

    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    const adminIds = (admins ?? []).map((a) => a.user_id);
    if (adminIds.length === 0) return { sent: 0 };

    return pushToUsers(adminIds, {
      title: "Nouvo siyalman 🚩",
      body: `Kòmand ${report.orders?.order_number ?? ""} · kont ${report.target_type === "courier" ? "livrè" : "restoran"} · ${report.reason_code}`,
      url: `/dashboard/admin/reports`,
      tag: `report-${report.id}`,
      data: { reportId: report.id, orderId: report.order_id },
      insistent: true,
    });
  });

/**
 * Called right after add_report_message_secure / set_report_status_secure /
 * reject_report_secure / resolve_report_secure / request_target_explanation_secure /
 * submit_target_explanation_secure succeeds. Notifies whichever OTHER party
 * needs to know, based on who just triggered it — never puts reporter
 * identity in a push that could reach the target.
 */
export const sendReportUpdatePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ReportIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await enforceRateLimit(supabase, "send_report_update_push", 40, 600))) {
      return { sent: 0, rateLimited: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .select(
        "id, order_id, reporter_id, target_type, target_id, status, shared_with_target_at, orders(order_number)",
      )
      .eq("id", data.reportId)
      .single();
    if (error || !report) throw new Error(error?.message || "Report not found");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    const adminIds = (roleRows ?? []).map((r) => r.user_id);
    const isTriggerAdmin = adminIds.includes(userId);

    let targetUserId: string | null = null;
    if (report.target_type === "courier") {
      const { data: dr } = await supabaseAdmin
        .from("drivers")
        .select("user_id")
        .eq("id", report.target_id)
        .maybeSingle();
      targetUserId = dr?.user_id ?? null;
    } else {
      const { data: res } = await supabaseAdmin
        .from("restaurants")
        .select("owner_id")
        .eq("id", report.target_id)
        .maybeSingle();
      targetUserId = res?.owner_id ?? null;
    }

    const orderNumber = report.orders?.order_number ?? "";
    let result = { sent: 0, sentByUser: {} as Record<string, number> };

    if (isTriggerAdmin) {
      // Admin aji — kliyan an toujou konnen (estati/repons); sib la SÈLMAN
      // si dosye a deja pataje AK li (jamè otomatikman).
      const recipients = [
        report.reporter_id,
        ...(report.shared_with_target_at ? [targetUserId] : []),
      ].filter((id): id is string => !!id && id !== userId);
      if (recipients.length > 0) {
        result = await pushToUsers(recipients, {
          title: `Dosye #${report.id.slice(0, 8)} mete ajou`,
          body: `Gen aktivite nan siyalman sou kòmand ${orderNumber}.`,
          url: recipients.includes(report.reporter_id)
            ? `/orders/${report.order_id}`
            : `/dashboard/${report.target_type === "courier" ? "driver" : "restaurant"}/reports`,
          tag: `report-${report.id}`,
          data: { reportId: report.id, orderId: report.order_id },
        });
        for (const uid of recipients) {
          await smsFallback({
            userId: uid,
            eventType: `report-update-${report.id}`,
            body: `NK Deliveri: mizajou sou dosye #${report.id.slice(0, 8)} (kòmand ${orderNumber}).`,
            pushSent: result.sentByUser[uid] ?? 0,
          });
        }
      }
    } else {
      // Kliyan (mesaj) oswa sib la (repons eksplikasyon) aji — nan tou de
      // ka yo, se admin yo sèl ki bezwen konnen.
      const recipients = adminIds.filter((id) => id !== userId);
      if (recipients.length > 0) {
        result = await pushToUsers(recipients, {
          title: "Nouvo aktivite nan yon siyalman",
          body: `Dosye #${report.id.slice(0, 8)} (kòmand ${orderNumber}) gen yon nouvo repons.`,
          url: `/dashboard/admin/reports`,
          tag: `report-${report.id}`,
          data: { reportId: report.id, orderId: report.order_id },
        });
      }
    }

    return result;
  });
