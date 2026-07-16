/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Offline strategy (SPEC §9): cache the app shell so it opens instantly; data
// always needs the network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// With injectManifest + registerType:"autoUpdate", the custom worker must claim
// control immediately. Without this a new deploy installs but stays "waiting"
// and keeps serving the old cached shell until every tab closes — so users see
// stale content after each release. skipWaiting + clients.claim hand control to
// the fresh worker on the next load, and the auto-update registration reloads.
self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ---- Web push (SPEC §8) --------------------------------------------------
// The refresh Edge Function sends a JSON body { title, body, url } per event.
// Every push MUST show a notification or Safari revokes the subscription.
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Release Notifier", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        // Focus an existing tab (and steer it to the title) rather than opening a new one.
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(url);
          } catch {
            /* cross-origin or not allowed — ignore */
          }
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
