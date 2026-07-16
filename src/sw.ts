/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Offline strategy (SPEC §9): cache the app shell so it opens instantly; data
// always needs the network. The `push` + `notificationclick` handlers, and the
// install-prompt plumbing, are added in the web-push slice (#35).
precacheAndRoute(self.__WB_MANIFEST);
