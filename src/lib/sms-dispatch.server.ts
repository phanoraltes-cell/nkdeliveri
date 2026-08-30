// TACH 2 (NOTIFIKASYON — SMS KÒM SEKOU) — sèl kote lojik "eske nou dwe
// voye yon SMS?" ekri, pou chak `send*Push` server function ka rele l
// menm jan (pa yon kopye-kole nan chak fichye). Menm posti ak
// push-dispatch.server.ts: yon echèk isit la JAMÈ dwe kraze aksyon ki
// deklannche l la (kreyasyon kòmand, siyalman, elatriye) — tout erè kaptire
// e anrejistre nan `notification_log`, jamè jete pi wo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSmsProvider } from "@/lib/sms/provider";

type SmsFallbackInput = {
  userId: string;
  eventType: string;
  /** Tèks SMS la — kout, an kreyòl, ak nimewo kòmand la (spec la mande sa espesifikman). */
  body: string;
  /** Rezilta push la deja eseye — SMS deklannche SÈLMAN si `pushSent === 0` (echwe oswa okenn abònman aktif), jan spec la mande. */
  pushSent: number;
};

async function resolvePhone(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  // profiles.phone dabò — sèl chan ki egziste pou TOUT wòl (kliyan, admin,
  // ak pwopriyetè/livrè ki pa t ranpli yon nimewo biznis separe). Sinon,
  // tonbe tounen sou nimewo biznis/livrè a.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.phone) return profile.phone;

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("phone")
    .eq("user_id", userId)
    .maybeSingle();
  if (driver?.phone) return driver.phone;

  const { data: restaurant } = await supabaseAdmin
    .from("restaurants")
    .select("phone")
    .eq("owner_id", userId)
    .maybeSingle();
  return restaurant?.phone ?? null;
}

/**
 * Eseye SMS kòm sekou pou YON itilizatè, sèlman lè push la echwe/pa gen
 * abònman aktif (`pushSent === 0`), respekte switch `prefs.sms_enabled`
 * (default aktive), ak yon limit anti-spam (1 SMS pa evènman/itilizatè,
 * max 3 SMS pa itilizatè pa è — check_rate_limit_secure ki egziste deja,
 * apèl ak `_actor_override` paske pa gen `auth.uid()` nan kontèks
 * service_role la).
 */
export async function smsFallback({
  userId,
  eventType,
  body,
  pushSent,
}: SmsFallbackInput): Promise<{ sent: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (pushSent > 0) return { sent: false };

  const { data: prefRow } = await supabaseAdmin
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const prefs = (prefRow?.prefs ?? {}) as Record<string, unknown>;
  if (prefs.sms_enabled === false) {
    await logNotification(supabaseAdmin, { userId, eventType, channel: "sms", status: "skipped" });
    return { sent: false };
  }

  const { data: allowed } = await supabaseAdmin.rpc("check_rate_limit_secure", {
    _action: "sms_fallback_" + eventType,
    _max_hits: 3,
    _window_seconds: 3600,
    _actor_override: userId,
  });
  if (!allowed) {
    await logNotification(supabaseAdmin, {
      userId,
      eventType,
      channel: "sms",
      status: "skipped",
      error: "rate_limited",
    });
    return { sent: false };
  }

  const phone = await resolvePhone(supabaseAdmin, userId);
  if (!phone) {
    await logNotification(supabaseAdmin, {
      userId,
      eventType,
      channel: "sms",
      status: "skipped",
      error: "no_phone_on_file",
    });
    return { sent: false };
  }

  const provider = getSmsProvider();
  const result = await provider.send(phone, body).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : "unknown error",
  }));

  await logNotification(supabaseAdmin, {
    userId,
    eventType,
    channel: "sms",
    body,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? undefined : result.error,
  });

  return { sent: result.ok };
}

export async function logNotification(
  supabaseAdmin: SupabaseClient<Database>,
  entry: {
    userId: string | null;
    eventType: string;
    channel: "push" | "sms" | "in_app";
    title?: string;
    body?: string;
    status: "sent" | "failed" | "skipped";
    error?: string;
  },
) {
  try {
    await supabaseAdmin.from("notification_log").insert({
      user_id: entry.userId,
      event_type: entry.eventType,
      channel: entry.channel,
      title: entry.title ?? null,
      body: entry.body ?? null,
      status: entry.status,
      error: entry.error ?? null,
    });
  } catch (err) {
    // Yon echèk sou JOUNAL LA li menm pa dwe janm kraze aksyon reyèl la —
    // log konsòl sèlman.
    console.warn("[notification_log] insert failed", err);
  }
}
