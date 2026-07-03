/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
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
};

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = payload.title || "NK Delivery";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: payload.tag,
    data: { url: payload.url || "/notifications", ...(payload.data || {}) },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
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