// Server-only push dispatch, shared by every send*Push TanStack server
// function (order/delivery lifecycle, payment review, refunds, disputes...).
// Extracted from send-order-push.functions.ts, which was the first caller —
// behavior is unchanged, this just gives every subsequent event type a
// single implementation to import instead of re-copying it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint-allowlist";

// NKD-006 SSRF fix (docs/NKD_FAZ2_SECURITY_AUDIT.md §4) — matches the
// AbortController + timeout convention already used by
// moncash-client.server.ts / plop-client.server.ts, not the newer
// AbortSignal.timeout() API, for consistency with the rest of this
// codebase's outbound-fetch code.
const PUSH_FETCH_TIMEOUT_MS = 15_000;

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
    // TACH 2 (siyalman C) — sèlman pou evènman ki mande yon aksyon rapid
    // (nouvo kòmand pou restoran, nouvo asiyasyon pou livrè): notifikasyon
    // an rete VIZIB sou ekran an jiskaske itilizatè a enteraji ak li
    // (requireInteraction), olye disparèt pou kont li apre kèk segond.
    // IMPORTANT — limit onèt: spec la mande yon repetisyon otomatik "jiska
    // 3 fwa si moun nan poko louvri l nan 60 segond". Sa a PA aplike isit
    // la: chak repetisyon ta mande yon NOUVO mesaj Push voye pa sèvè a
    // (Push se yon sèl-kou pa design), e kenbe yon fonksyon serverless
    // Vercel louvri pandan 60s pou fè sa a se yon risk fyabilite reyèl
    // (limit tan platfòm la, kout ki ka echwe san rezon). `requireInteraction`
    // sèl la deja bay pi gwo pati benefis la (notifikasyon an pa ka "pase
    // inapèsi" yon fwa li rive) san risk sa a — repetisyon otomatik ta
    // mande yon vrè travay pwograme dirab (pa egziste kounye a), siyale
    // kòm limit nan rapò final la.
    insistent?: boolean;
  },
) {
  if (userIds.length === 0) return { sent: 0, sentByUser: {} as Record<string, number> };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logNotification } = await import("@/lib/sms-dispatch.server");

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

  const prefsByUser = new Map(
    (prefRows ?? []).map((r) => [r.user_id, r.prefs as Record<string, unknown>]),
  );

  // TACH 2 (siyalman E) — switch pa kanal "Push sou telefòn" (kle
  // `push_enabled` nan MENM jsonb preferans lan, defo aktive). Verifye ISIT
  // LA (pa nan appelant yo) pou chak appelant deja jwenn menm konpòtman an
  // gratis, san yo pa bezwen re-enplemante l chak fwa.
  const pushDisabledUsers = new Set(
    userIds.filter((uid) => prefsByUser.get(uid)?.push_enabled === false),
  );
  const eligibleSubs = (subs ?? []).filter((s) => !pushDisabledUsers.has(s.user_id));

  if (!eligibleSubs.length) {
    await Promise.all(
      userIds.map((uid) =>
        logNotification(supabaseAdmin, {
          userId: uid,
          eventType: payload.tag,
          channel: "push",
          title: payload.title,
          status: "skipped",
          error: pushDisabledUsers.has(uid) ? "push_disabled" : "no_subscription",
        }),
      ),
    );
    return { sent: 0, sentByUser: {} as Record<string, number> };
  }

  const { buildPushPayload } = await import("@block65/webcrypto-web-push");
  const vapid = {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: JSON.parse(process.env.VAPID_PRIVATE_JWK!),
  };

  let sent = 0;
  const sentByUser: Record<string, number> = {};
  const attemptedUsers = new Set<string>();
  const deadEndpoints: string[] = [];
  await Promise.all(
    eligibleSubs.map(async (s) => {
      attemptedUsers.add(s.user_id);
      try {
        const prefs = prefsByUser.get(s.user_id);
        const soundOn = prefs?.sound !== false;
        const vibrationOn = prefs?.vibration !== false;
        // The Notification API has no custom-sound-file support in any
        // current browser (see the accompanying report) — `silent` is the
        // only lever, and it's honored by sw.ts's push handler, not here;
        // this just decides what to tell it to do for this recipient.
        const message = {
          data: JSON.stringify({
            ...payload,
            silent: !soundOn,
            vibrate: vibrationOn,
            requireInteraction: payload.insistent === true,
          }),
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
        // Re-checked here even though public.push_subscriptions has its own
        // CHECK constraint on `endpoint` (NKD-006) — this is the second of
        // the fix's two layers: the DB stops bad data from being written at
        // all, this stops the fetch itself from ever reaching a
        // disallowed/internal host, whichever way a row got here. A row
        // that fails this can never pass it later either, so it's cleaned
        // up the same way a dead (404/410) endpoint is.
        if (!isAllowedPushEndpoint(s.endpoint)) {
          console.warn("[push] rejected endpoint outside the allowlist", s.endpoint);
          deadEndpoints.push(s.endpoint);
          return;
        }

        const built = await buildPushPayload(message, subscription, vapid);
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), PUSH_FETCH_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(s.endpoint, {
            ...(built as unknown as RequestInit),
            // Without this, a host that passes the allowlist check (e.g. a
            // real fcm.googleapis.com response) could still redirect the
            // request to an internal address and have `fetch` follow it
            // automatically — "manual" makes that a no-op response instead.
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutHandle);
        }
        if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
          console.warn("[push] endpoint attempted a redirect, refusing to follow", s.endpoint);
          return;
        }
        if (res.status === 404 || res.status === 410) deadEndpoints.push(s.endpoint);
        else if (res.ok || res.status === 201) {
          sent++;
          sentByUser[s.user_id] = (sentByUser[s.user_id] ?? 0) + 1;
        }
      } catch (err) {
        console.warn("[push] send failed", err);
      }
    }),
  );
  if (deadEndpoints.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  // TACH 2 (siyalman F) — jounal fyabilite, YON RANJE PA ITILIZATÈ demande
  // (pa pa aparèy — plizyè aparèy pou menm moun se yon detay livrezon, pa
  // yon evènman diferan pou depanaj).
  await Promise.all(
    userIds.map((uid) => {
      const status: "sent" | "failed" | "skipped" = pushDisabledUsers.has(uid)
        ? "skipped"
        : !attemptedUsers.has(uid)
          ? "skipped"
          : (sentByUser[uid] ?? 0) > 0
            ? "sent"
            : "failed";
      return logNotification(supabaseAdmin, {
        userId: uid,
        eventType: payload.tag,
        channel: "push",
        title: payload.title,
        body: payload.body,
        status,
        error: status === "skipped" && !pushDisabledUsers.has(uid) ? "no_subscription" : undefined,
      });
    }),
  );

  return { sent, sentByUser };
}
