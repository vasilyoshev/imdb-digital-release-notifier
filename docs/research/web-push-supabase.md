# Research: Sending Web Push from a Supabase Edge Function (Deno)

Resolves [#4](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/4). Researched 2026-07-15 against primary sources (Supabase docs, MDN, W3C/IETF specs, webkit.org, library repos). Context: rebuilt app is a Vite + React SPA (PWA via vite-plugin-pwa) on Netlify with a Supabase backend; a daily Edge Function must push release-date events to the single user's subscribed browsers.

## TL;DR — recommended approach

- **Library:** `jsr:@negrel/webpush` (WebCrypto-only RFC 8291/8292 implementation, MIT, v0.5.0 mid-2025). Avoid `npm:web-push` — its historical Deno blockers are fixed upstream but it is unverified on Supabase's runtime and drags in Node polyfills.
- **VAPID keys:** generate once with `generateVapidKeys()` → `exportVapidKeys()` (JWK pair), store the JSON in a single Supabase secret (`VAPID_KEYS_JSON`); derive the browser's `applicationServerKey` with `exportApplicationServerKey()` (public, ships in the frontend).
- **Subscriptions:** stored in a `push_subscriptions` Postgres table keyed on `endpoint`; upsert on subscribe, delete on 404/410 from the push service.
- **Client:** vite-plugin-pwa `injectManifest` strategy with a custom `sw.ts` containing `push` + `notificationclick` listeners; subscribe from a click handler (required gesture).
- **iOS:** works only from iOS/iPadOS 16.4+ **and only when the PWA is added to the Home Screen**; permission must come from a tap; every push must show a notification or Safari revokes the subscription.
- **Limits:** a daily run sending 5–20 pushes is far inside Supabase Edge Function limits (2 s CPU, 150–400 s wall clock).

---

## 1. Runtime and library choice

### Supabase Edge Functions runtime today

- Edge Functions run on Supabase's open-source [edge-runtime](https://github.com/supabase/edge-runtime), Deno-compatible ([docs: Edge Functions](https://supabase.com/docs/guides/functions)).
- All regions run the **Deno 2.1-compatible release** since 2025-08-15 ([changelog #37941](https://supabase.com/changelog/37941-all-regions-now-run-deno-2-1-compatible-release); announcement: [blog, Apr 2025](https://supabase.com/blog/supabase-edge-functions-deploy-dashboard-deno-2-1)). Some doc pages still say Deno 1.46 and are stale ([wasm guide](https://supabase.com/docs/guides/functions/wasm)).
- `npm:`, `jsr:`, and `node:` (Node built-ins) import specifiers are all supported ([dependencies guide](https://supabase.com/docs/guides/functions/dependencies)); NPM compat is GA ([features matrix](https://supabase.com/docs/guides/getting-started/features)).

### `npm:web-push` — probably works, not recommended

- `web-push` depends on `asn1.js`, `http_ece`, `jws`, `https-proxy-agent` — i.e. `node:crypto` (ECDH, AES-128-GCM, ES256) and `node:https` ([package.json](https://github.com/web-push-libs/web-push/blob/master/package.json)).
- It was broken under Deno: AES-GCM payloads failed to decrypt in Chrome ([denoland/deno#23693](https://github.com/denoland/deno/issues/23693)), fixed Aug 2024 ([denoland/deno#25261](https://github.com/denoland/deno/pull/25261)); EC private-key signing for VAPID JWTs was also broken in edge-runtime ([supabase/edge-runtime#334](https://github.com/supabase/edge-runtime/issues/334), closed via upstream [denoland/deno#22914](https://github.com/denoland/deno/pull/22914)).
- Both blockers are fixed in the Deno 2.1-era runtime, so it *should* work — but no Supabase doc or test asserts it, and Supabase's own [dependency-analysis guidance](https://supabase.com/docs/guides/troubleshooting/edge-function-dependency-analysis) recommends native Deno APIs over NPM polyfill chains for bundle/boot cost.

### Recommended: `jsr:@negrel/webpush`

[jsr.io/@negrel/webpush](https://jsr.io/@negrel/webpush) / [github.com/negrel/webpush](https://github.com/negrel/webpush) — MIT, implements RFC 8291 (encryption) + RFC 8292 (VAPID) purely on SubtleCrypto/Web APIs. v0.5.0 (2025-06-29) added `exportApplicationServerKey`. Small project (0 open issues; README notes it hasn't had a formal crypto review) but current and Deno/Supabase-targeted (author walkthrough: [negrel.dev blog](https://www.negrel.dev/blog/deno-web-push-notifications/)).

API surface (verified in source: `vapid.ts`, `application_server.ts`, `subscriber.ts`):

```ts
import * as webpush from "jsr:@negrel/webpush";

// one-time, local: generate + export keys
const keys = await webpush.generateVapidKeys({ extractable: true }); // ECDSA P-256 CryptoKeyPair
const exported = await webpush.exportVapidKeys(keys);                 // { publicKey: JsonWebKey, privateKey: JsonWebKey }

// in the Edge Function
const vapidKeys = await webpush.importVapidKeys(
  JSON.parse(Deno.env.get("VAPID_KEYS_JSON")!),
  { extractable: false },
);
const appServer = await webpush.ApplicationServer.new({
  contactInformation: "mailto:you@example.com",
  vapidKeys,
});
const subscriber = appServer.subscriber(pushSubscriptionJson); // { endpoint, keys: { p256dh, auth } }
await subscriber.pushTextMessage(JSON.stringify(payload), {}); // throws PushMessageError on non-OK
```

Fallback alternative if needed: [`@block65/webcrypto-web-push`](https://github.com/block65/webcrypto-web-push) (WebCrypto-based, claims Deno support). [`webpush-webcrypto`](https://github.com/alastaircoote/webpush-webcrypto) is untested on Deno per its author.

### No official Supabase Web Push example exists

Supabase's [Sending Push Notifications example](https://supabase.com/docs/guides/functions/examples/push-notifications) covers **Expo Push and FCM only** — there is no first-party raw Web Push (VAPID + RFC 8291) example in Supabase docs or blog. Plan accordingly: this is third-party-library territory.

## 2. VAPID key generation and storage

1. Generate once, locally: `deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts` (or the two-liner above) → JWK-pair JSON.
2. Store the whole JSON as one Edge Function secret ([secrets docs](https://supabase.com/docs/guides/functions/secrets)):
   ```sh
   supabase secrets set VAPID_KEYS_JSON='{"publicKey":{...},"privateKey":{...}}'
   ```
   Local dev reads `supabase/functions/.env`. Read at boot with `Deno.env.get("VAPID_KEYS_JSON")`. A JWK pair (~400 bytes) is well within secret limits.
3. The **public** application-server key for the browser comes from `exportApplicationServerKey()` (base64url, uncompressed P-256 point per the [Push API spec](https://w3c.github.io/push-api/)); embed it in the frontend as a Vite env var — it is not secret.
4. Never rotate casually: changing VAPID keys invalidates all existing subscriptions.

## 3. Client-side subscription flow (Vite React PWA)

### Subscribe (must be user-gesture driven)

- `Notification.requestPermission()` should be called from a click handler ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)); browsers increasingly hard-require a gesture for `pushManager.subscribe()` too ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)).
- Subscribe with `userVisibleOnly: true` (Chrome/Edge reject otherwise; Safari requires it) and `applicationServerKey` as the base64url VAPID public key string or its decoded `Uint8Array` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [Push API spec](https://w3c.github.io/push-api/)).
- `subscription.toJSON()` yields `{ endpoint, expirationTime, keys: { p256dh, auth } }` ([MDN toJSON](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/toJSON)); POST that to the backend. The endpoint is a capability URL — treat it as a secret ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)).

### vite-plugin-pwa

- Use the **`injectManifest` strategy** with a custom `src/sw.ts` (`strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts'`); keep `precacheAndRoute(self.__WB_MANIFEST)` and add `push` + `notificationclick` listeners ([inject-manifest guide](https://vite-pwa-org.netlify.app/guide/inject-manifest.html)):
  ```ts
  self.addEventListener("push", (e) => {
    const data = e.data!.json();
    e.waitUntil(self.registration.showNotification(data.title, { body: data.body, data }));
  });
  self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(self.clients.openWindow(e.notification.data?.url ?? "/"));
  });
  ```
- Dev testing: `devOptions: { enabled: true, type: 'module' }`; module-type dev SW works in Chromium — test Safari against a production build ([development guide](https://vite-pwa-org.netlify.app/guide/development.html)).

### Subscription storage schema (Postgres)

Key on `endpoint` (the subscription's natural unique ID; web.dev's reference server code also identifies/deletes by endpoint — [web.dev](https://web.dev/articles/sending-messages-with-web-push-libraries)):

```sql
create table push_subscriptions (
  id          bigint generated always as identity primary key,
  endpoint    text not null unique,          -- capability URL; natural key, treat as secret
  p256dh      text not null,                 -- keys.p256dh from toJSON()
  auth        text not null,                 -- keys.auth from toJSON()
  user_agent  text,                          -- label, e.g. "iPhone Safari"
  created_at  timestamptz not null default now()
);
-- RLS: enable; no anon policies (single-user app: write via Edge Function with service role,
-- or authenticated-user policies if the SPA talks to PostgREST directly).
```

Upsert on subscribe (`on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`) — browsers can re-issue an endpoint with rotated keys. `expirationTime` is nearly always null; skip it.

### Pruning stale subscriptions

- Push services return **404** for expired subscriptions per [RFC 8030 §7.3](https://www.rfc-editor.org/rfc/rfc8030#section-7.3); real-world services (FCM endpoints, Mozilla autopush) also return **410 Gone**. Standard practice: on 404 or 410, delete the row ([web.dev](https://web.dev/articles/sending-messages-with-web-push-libraries)). With `@negrel/webpush`, catch `PushMessageError`, check the response status, and `delete from push_subscriptions where endpoint = $1`.
- Do not rely on the SW `pushsubscriptionchange` event — MDN flags it as limited availability and it is effectively non-functional in Chrome ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event)). Server-side 404/410 pruning is the dependable mechanism.

## 4. iOS Safari PWA constraints

From webkit.org primary sources:

- Web Push on iPhone/iPad requires **iOS/iPadOS 16.4+** and the web app **added to the Home Screen** (manifest with `display: standalone`/`fullscreen`); browser-tab Safari on iOS cannot receive push ([Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- Permission may only be requested "in response to direct user interaction" — a tap on a subscribe button (same post).
- `userVisibleOnly: true` is mandatory and enforced: every push must result in a shown notification; "violations of the userVisibleOnly promise will result in a push subscription being revoked" — no silent push ([Meet Web Push](https://webkit.org/blog/12945/meet-web-push/); macOS Safari 16 shipped Web Push first).
- Optional future nicety: Declarative Web Push (JSON payload displayed without SW involvement) shipped for testing in iOS 18.4 / macOS 15.5 beta; backwards-compatible, not required ([Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).

Practical UX for this app: show an "Enable notifications" button (never auto-prompt); on iOS, detect non-standalone display mode and show "Add to Home Screen first" instructions.

## 5. Supabase Edge Function gotchas

- **Limits** ([limits docs](https://supabase.com/docs/guides/functions/limits)): 256 MB memory, **2 s CPU time** ("does not include async I/O"), wall clock 150 s (Free) / 400 s (Paid), 150 s request idle timeout. Outbound push HTTPS calls are async I/O; only payload encryption burns CPU (milliseconds per message). Sending 5–20 pushes — even sequentially — is a non-issue; use `Promise.allSettled` over subscriptions so one dead endpoint doesn't abort the rest.
- **Background tasks:** `EdgeRuntime.waitUntil(promise)` can finish the pushes after responding to the cron trigger; local dev needs `[edge_runtime] policy = "per_worker"` ([background-tasks docs](https://supabase.com/docs/guides/functions/background-tasks)). Optional at this scale.
- **Secrets/env:** `supabase secrets set` / dashboard; `Deno.env.get()`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically ([secrets docs](https://supabase.com/docs/guides/functions/secrets)).
- **Daily scheduling:** `pg_cron` + `pg_net` calling the function via `net.http_post`, with the function URL/key kept in Vault ([schedule-functions docs](https://supabase.com/docs/guides/functions/schedule-functions)).

## 6. Recommended end-to-end flow

1. One-time: generate VAPID JWK pair → `supabase secrets set VAPID_KEYS_JSON=...`; put the base64url public key in the frontend env.
2. SPA (installed PWA on iOS): user taps "Enable notifications" → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → upsert `toJSON()` into `push_subscriptions`.
3. Daily `pg_cron` job → `pg_net` POST → `notify-releases` Edge Function.
4. Function: compute new release events → load subscriptions → `ApplicationServer.new({ vapidKeys })` → `Promise.allSettled(subs.map(s => appServer.subscriber(s).pushTextMessage(...)))` → delete rows whose send failed with 404/410.
5. SW `push` handler always calls `showNotification`; `notificationclick` opens the movie page.

## Sources

Supabase: [functions overview](https://supabase.com/docs/guides/functions) · [dependencies](https://supabase.com/docs/guides/functions/dependencies) · [limits](https://supabase.com/docs/guides/functions/limits) · [secrets](https://supabase.com/docs/guides/functions/secrets) · [background tasks](https://supabase.com/docs/guides/functions/background-tasks) · [schedule functions](https://supabase.com/docs/guides/functions/schedule-functions) · [push-notifications example (Expo/FCM only)](https://supabase.com/docs/guides/functions/examples/push-notifications) · [Deno 2.1 changelog](https://supabase.com/changelog/37941-all-regions-now-run-deno-2-1-compatible-release) · [dependency analysis](https://supabase.com/docs/guides/troubleshooting/edge-function-dependency-analysis)

Libraries: [negrel/webpush](https://github.com/negrel/webpush) · [jsr:@negrel/webpush](https://jsr.io/@negrel/webpush) · [web-push package.json](https://github.com/web-push-libs/web-push/blob/master/package.json) · [denoland/deno#23693](https://github.com/denoland/deno/issues/23693) · [denoland/deno#25261](https://github.com/denoland/deno/pull/25261) · [supabase/edge-runtime#334](https://github.com/supabase/edge-runtime/issues/334) · [block65/webcrypto-web-push](https://github.com/block65/webcrypto-web-push)

Web platform: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) · [MDN PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) · [MDN PushSubscription.toJSON](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/toJSON) · [MDN requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static) · [MDN pushsubscriptionchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event) · [W3C Push API](https://w3c.github.io/push-api/) · [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) · [web.dev web-push libraries](https://web.dev/articles/sending-messages-with-web-push-libraries)

vite-plugin-pwa: [injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest.html) · [development](https://vite-pwa-org.netlify.app/guide/development.html)

WebKit: [Web Push for Web Apps on iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Meet Web Push](https://webkit.org/blog/12945/meet-web-push/) · [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)
