/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// --- Precache & routing --------------------------------------------------
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  new NavigationRoute(new NetworkFirst({ cacheName: "html-nav", networkTimeoutSeconds: 5 }), {
    denylist: [/^\/~oauth/, /^\/api\//],
  }),
);

registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin && /\.(?:js|css|woff2|png|svg|jpg|jpeg|webp)$/.test(url.pathname),
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// A navigation that isn't in the precache list (a route not visited before
// this SW install) and can't reach the network — NetworkFirst above has no
// cache entry to fall back to and would otherwise surface the browser's own
// "no internet" interstitial. offline.html is a plain static page (no JS
// bundle dependency, unlike every actual app route) precached alongside
// everything else, so it's always available offline.
setCatchHandler(async ({ event }) => {
  // Workbox's own types are imprecise here — a catch handler triggered by a
  // failed fetch always receives a FetchEvent (which has `.request`), but
  // its declared type is the base ExtendableEvent.
  const request = (event as FetchEvent).request;
  if (request?.mode === "navigate") {
    return (await matchPrecache("/offline.html")) ?? Response.error();
  }
  return Response.error();
});

// --- Skip-waiting bridge for update prompt -------------------------------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// --- Web Push ------------------------------------------------------------
type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
  // Set server-side from the recipient's notification_preferences
  // (sound/vibration keys) — see push-dispatch.server.ts. There is no
  // custom-sound-file support in the Notification API on any browser
  // today; `silent` only toggles the OS's own default notification sound
  // on or off, which is the one lever actually available here.
  silent?: boolean;
  vibrate?: boolean;
};

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = payload.title || "NK Deliveri";
  const targetUrl = payload.url || "/notifications";
  const options = {
    body: payload.body || "",
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: payload.tag,
    data: { url: targetUrl, ...(payload.data || {}) },
    requireInteraction: false,
    silent: payload.silent === true,
    // A pattern, not a boolean — Notification.vibrate expects
    // milliseconds on/off. Empty array = no vibration. Browsers that
    // don't support vibration (desktop Chrome/Firefox, all of Safari)
    // silently ignore this — the graceful degradation is automatic, not
    // something this code has to detect. TypeScript's NotificationOptions
    // doesn't declare `vibrate` even though it's a real, supported part
    // of the spec — same class of DOM-lib gap as the RequestInit cast
    // below for buildPushPayload's output.
    vibrate: payload.vibrate === false ? [] : [200, 100, 200],
  } as NotificationOptions;

  event.waitUntil(
    (async () => {
      // If the recipient already has this exact page focused, their screen
      // already reflects the change via Realtime (chat messages, order
      // status, etc.) — a system-level popup on top of that would just be a
      // redundant interruption for something they're already looking at.
      // WindowClient.focused is well-supported (Chrome/Firefox/Edge); where
      // it's undefined (older Safari) this simply never matches and falls
      // back to always showing the notification, the previous behavior.
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const alreadyFocusedHere = clients.some(
        (c) =>
          "focused" in c && (c as WindowClient).focused && new URL(c.url).pathname === targetUrl,
      );
      if (alreadyFocusedHere) return;
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await (client as WindowClient).focus();
          await (client as WindowClient).navigate(targetUrl).catch(() => undefined);
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

export {};
