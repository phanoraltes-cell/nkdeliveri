// Server-only push dispatch, shared by every send*Push TanStack server
// function (order/delivery lifecycle, payment review, refunds, disputes...).
// Extracted from send-order-push.functions.ts, which was the first caller —
// behavior is unchanged, this just gives every subsequent event type a
// single implementation to import instead of re-copying it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Same check_rate_limit_secure call/throw/return shape that used to be
 * copy-pasted at the top of every send*Push handler. Returns whether the
 * caller is within its limit — callers still decide what to return when
 * it's false (usually `{ sent: 0, rateLimited: true }`), since a helper
 * can't short-circuit its caller's own return.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient<Database>,
  action: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data: allowed, error } = await supabase.rpc("check_rate_limit_secure", {
    _action: action,
    _max_hits: maxHits,
    _window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message);
  return !!allowed;
}

export async function pushToUsers(
  userIds: string[],
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
    data?: Record<string, unknown>;
  },
) {
  if (userIds.length === 0) return { sent: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: subs, error: subsErr }, { data: prefRows, error: prefErr }] = await Promise.all([
    supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      // "désactiver les notifications pour un appareil uniquement" (Mes
      // appareils) — a per-device pause that keeps the registration
      // instead of deleting it.
      .eq("enabled", true)
      .in("user_id", userIds),
    supabaseAdmin.from("notification_preferences").select("user_id, prefs").in("user_id", userIds),
  ]);
  // Push delivery is a best-effort side effect of a state change that has
  // already been recorded — log rather than throw, so a subscriptions
  // lookup failure doesn't get mistaken for that change itself failing.
  if (subsErr) console.error("[pushToUsers] failed to load subscriptions", subsErr);
  if (prefErr) console.error("[pushToUsers] failed to load preferences", prefErr);
  if (!subs || subs.length === 0) return { sent: 0 };

  // sound/vibration default to on, same "enabled unless explicitly turned
  // off" convention private.notify_secure already uses for every category
  // except promotions.
  const prefsByUser = new Map(
    (prefRows ?? []).map((r) => [r.user_id, r.prefs as Record<string, unknown>]),
  );

  const { buildPushPayload } = await import("@block65/webcrypto-web-push");
  const vapid = {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: JSON.parse(process.env.VAPID_PRIVATE_JWK!),
  };

  let sent = 0;
  const deadEndpoints: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        const prefs = prefsByUser.get(s.user_id);
        const soundOn = prefs?.sound !== false;
        const vibrationOn = prefs?.vibration !== false;
        // The Notification API has no custom-sound-file support in any
        // current browser (see the accompanying report) — `silent` is the
        // only lever, and it's honored by sw.ts's push handler, not here;
        // this just decides what to tell it to do for this recipient.
        const message = {
          data: JSON.stringify({ ...payload, silent: !soundOn, vibrate: vibrationOn }),
          options: { ttl: 60 * 60 * 24 },
        };
        // The web-push package's PushSubscription type carries expirationTime
        // (from the browser API) — the Supabase row never stores it, so it's
        // always null here, which the package treats the same as absent.
        const subscription = {
          endpoint: s.endpoint,
          expirationTime: null,
          keys: { p256dh: s.p256dh, auth: s.auth },
        };
        const built = await buildPushPayload(message, subscription, vapid);
        const res = await fetch(s.endpoint, built as unknown as RequestInit);
        if (res.status === 404 || res.status === 410) deadEndpoints.push(s.endpoint);
        else if (res.ok || res.status === 201) sent++;
      } catch (err) {
        console.warn("[push] send failed", err);
      }
    }),
  );
  if (deadEndpoints.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }
  return { sent };
}
