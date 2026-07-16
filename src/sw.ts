/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Offline strategy (SPEC §9): cache the app shell so it opens instantly; data
// always needs the network. The `push` + `notificationclick` handlers, and the
// install-prompt plumbing, are added in the web-push slice (#35).
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
