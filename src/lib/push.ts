import { supabase } from "@/integrations/supabase/client";

// VAPID public key is safe to expose (paired with a server-only private key).
const VAPID_PUBLIC_KEY =
  "BJ06H-steLp_4SCqpiR746JG6cBaOiccHD6vrIY9w6zVqHo0ABCgxfer4j8RuDkRjfbXq2fYjKJ2ymeKHEFtUK8";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function subscribeToPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPushSupported()) return { ok: false, error: "Navigatè a pa sipòte notifikasyon push." };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Pèmisyon refize." };

  const reg = await getReadyRegistration();
  if (!reg) return { ok: false, error: "Service worker pa pare." };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(
        key.byteOffset,
        key.byteOffset + key.byteLength,
      ) as ArrayBuffer,
    });
  }

  const json = sub.toJSON();
  const endpoint = sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "Souskripsyon envalid." };

  // getSession() (not getUser()) — same reasoning as the dashboard route
  // guard: reads the persisted/auto-refreshed local session instead of
  // depending on a network round trip to Supabase's Auth API just to
  // register a push subscription.
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return { ok: false, error: "Ou dwe konekte." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<{ ok: boolean; error?: string }> {
  const reg = await getReadyRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { ok: true };

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  if (error) return { ok: false, error: error.message };
  // Only unsubscribe at the browser level once the row is actually gone —
  // otherwise a DB-side failure would leave a stale subscription the
  // server keeps trying (and failing) to push to, with no way for the
  // user to tell anything is wrong.
  await sub.unsubscribe();
  return { ok: true };
}
