// Server-only push dispatch, shared by every send*Push TanStack server
// function (order/delivery lifecycle, payment review, refunds, disputes...).
// Extracted from send-order-push.functions.ts, which was the first caller —
// behavior is unchanged, this just gives every subsequent event type a
// single implementation to import instead of re-copying it.

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

  const { data: subs, error: subsErr } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  // Push delivery is a best-effort side effect of a state change that has
  // already been recorded — log rather than throw, so a subscriptions
  // lookup failure doesn't get mistaken for that change itself failing.
  if (subsErr) console.error("[pushToUsers] failed to load subscriptions", subsErr);
  if (!subs || subs.length === 0) return { sent: 0 };

  const { buildPushPayload } = await import("@block65/webcrypto-web-push");
  const vapid = {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: JSON.parse(process.env.VAPID_PRIVATE_JWK!),
  };
  const message = {
    data: JSON.stringify(payload),
    options: { ttl: 60 * 60 * 24 },
  };

  let sent = 0;
  const deadEndpoints: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
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
