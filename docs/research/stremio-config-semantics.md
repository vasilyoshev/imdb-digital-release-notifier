# Research: Stremio configurable-addon semantics

Resolves wayfinder research ticket [#110](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/110)
(child of map [#109](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/109) — configurable Stremio
addon served from the Cloudflare Worker at `https://release-notifier.yoshevbot.uk` with routes
`/{token}/manifest.json` and `/{token}/catalog/movie/...`).

All claims are cited against primary sources, pinned to the commits that were current on the default branches as of
2026-07-26:

- `stremio-addon-sdk` @ [`2728da3`](https://github.com/Stremio/stremio-addon-sdk/tree/2728da3ee853207cd5ee200aabe15a08cc1d01d1)
- `stremio-web` @ [`daf74b0`](https://github.com/Stremio/stremio-web/tree/daf74b0ec973054c94de9f0f8271b3234bd26c43)
- `stremio-core` @ [`eeb89ff`](https://github.com/Stremio/stremio-core/tree/eeb89ff8c7f401b50c435933dab399daa956dc35)
- `stremio-api-client` @ [`c303559`](https://github.com/Stremio/stremio-api-client/tree/c303559b9e314b691484cc6cfc07c141cef17767)
- `stremio-shell` @ [`c3a8bcb`](https://github.com/Stremio/stremio-shell/tree/c3a8bcbf857d5569b6ae7444ead0dc0a0814888b)

One structural caveat up front: **`api.strem.io` (the Stremio account/API server) is closed-source.** Everything the
open clients do is cited below; the one place behavior can only be inferred (server-side manifest re-fetch on
`addonCollectionGet update:true`) is explicitly flagged.

---

## 1. `behaviorHints.configurable` and `behaviorHints.configurationRequired`

**Spec** — [`docs/api/responses/manifest.md`](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/docs/api/responses/manifest.md), section "Other metadata" → `behaviorHints`:

- `configurable` — "boolean, default is `false`, if the addon supports settings, will add a button next to 'Install'
  in Stremio that will point to the `/configure` path on the addon's domain".
- `configurationRequired` — "boolean, default is `false`, if set to `true` the 'Install' button will not show for
  your addon in Stremio, instead a 'Configure' button will show pointing to the `/configure` path on the addon's
  domain".

The same file's "User data" section: setting `manifest.config` (with `behaviorHints.configurable: true`) makes the
SDK's landing page redirect to `/configure` with an auto-generated configuration page. We are not using the SDK, so
we must serve `/configure` ourselves — that path is the contract, per
[`docs/advanced.md` → "Creating Addon Configuration Pages"](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/docs/advanced.md#creating-addon-configuration-pages):
"create a web page on the `/configure` path of your addon and set `manifest.behaviorHints.configurable` to `true`".

**Actual UI produced** — [`stremio-web/src/routes/Addons/Addon/Addon.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/routes/Addons/Addon/Addon.js) (buttons block near the end of the component):

- Gear (settings-icon) button rendered when `!behaviorHints.configurationRequired && behaviorHints.configurable` —
  i.e. a *Configure* affordance **next to** the main button.
- Main button logic (both `title` and `onClick`):
  `installed ? Uninstall : behaviorHints.configurationRequired ? Configure : Install`.
  So with `configurationRequired: true` the primary button **is** "Configure" (opens `/configure` externally,
  does not install); otherwise it is "Install"/"Uninstall".

The addon-details modal ([`stremio-web/src/components/AddonDetailsModal/AddonDetailsModal.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/components/AddonDetailsModal/AddonDetailsModal.js))
mirrors this: a `configureButton` is added when the freshly fetched remote manifest has
`behaviorHints.configurable`, and the Install button is only built when
`!...behaviorHints.configurationRequired` (otherwise no install button at all).

**Enforced in core, not just UI** — [`stremio-core/src/models/ctx/update_profile.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/models/ctx/update_profile.rs):
the `Internal::InstallAddon` arm rejects the install with `OtherError::AddonConfigurationRequired` when
`addon.manifest.behavior_hints.configuration_required` is set; the `ActionCtx::UpgradeAddon` arm does the same.
So a manifest with `configurationRequired: true` is uninstallable by any UI built on stremio-core.

## 2. How the Configure button builds its URL

Exact code, two call sites in stremio-web (the UI used by both the web app and the desktop shell):

- [`src/routes/Addons/Addons.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/routes/Addons/Addons.js), `onAddonConfigure`:

  ```js
  platform.openExternal(event.dataset.addon.transportUrl.replace('manifest.json', 'configure'));
  ```

- [`src/components/AddonDetailsModal/AddonDetailsModal.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/components/AddonDetailsModal/AddonDetailsModal.js), `configureButton.props.onClick`:

  ```js
  platform.openExternal(transportUrl.replace('manifest.json', 'configure'));
  ```

So for a transport URL `https://release-notifier.yoshevbot.uk/{token}/manifest.json`, Configure opens
**`https://release-notifier.yoshevbot.uk/{token}/configure`** — a naive JS `String.replace` (first occurrence) of the
literal `manifest.json`, keeping the rest of the URL (our token path segment) intact. No query string is appended.
(Corollary: a token must never contain the substring `manifest.json`; ours won't.)

It is opened via `platform.openExternal` — in the browser that is a new tab; in the desktop shell, the system
browser. The page opened is *our* web page; Stremio passes no user identity to it — the only state it carries is
whatever is in the URL (our token).

Platform notes:

- **Web + desktop**: both run stremio-web — the desktop shell is a thin wrapper that loads
  `https://app.strem.io/shell-v{ver}/` ([`stremio-shell/main.qml`](https://github.com/Stremio/stremio-shell/blob/c3a8bcbf857d5569b6ae7444ead0dc0a0814888b/main.qml), `README.md`), so the substitution above is what runs there too.
- **Android/TV/iOS**: the mobile/TV app frontends are not fully open-source, so their exact code could not be
  verified. They are built on stremio-core, and the `/configure` path contract is what the official manifest docs
  specify (§1), so the same URL shape is the documented expectation.

## 3. Manifest refresh of installed addons

There is **no client-side periodic re-fetch of installed third-party manifests**. What exists, per source:

- **Trigger/cadence** — [`stremio-web/src/App/App.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/App/App.js):
  an effect dispatches `Ctx/PullAddonsFromAPI` (plus `PullUserFromAPI`, `SyncLibraryWithAPI`, `PullNotifications`)
  **once on app start and again on every window `focus` event** (`onWindowFocus()` is called immediately and bound to
  `window` focus). That is the cadence: every time the user opens or refocuses Stremio.

- **What the pull does** — [`stremio-core/src/models/ctx/update_profile.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/models/ctx/update_profile.rs):
  - Logged-in: `pull_addons_from_api` sends `APIRequest::AddonCollectionGet { auth_key, update: true }` (struct
    defined in [`src/types/api/request.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/types/api/request.rs);
    unit tests pin the wire form `POST https://api.strem.io/api/addonCollectionGet` with `"update":true` —
    [`src/unit_tests/ctx/pull_addons_from_api.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/unit_tests/ctx/pull_addons_from_api.rs)).
    On response (`Internal::AddonsAPIResult` arm), the client **wholesale replaces `profile.addons` with the
    collection the API returned** whenever it differs.
  - Anonymous (no auth key): the local fallback only bumps addons whose `manifest.id` matches an entry in the
    baked-in `OFFICIAL_ADDONS` list with a newer version. **Third-party manifests are never re-fetched locally.**

- **The server side is closed-source.** `update: true` asks api.strem.io for an *updated* collection (the legacy
  official client [`stremio-api-client/apiStore.js`](https://github.com/Stremio/stremio-api-client/blob/c303559b9e314b691484cc6cfc07c141cef17767/apiStore.js)
  `pullAddonCollection` sends the same `{ update: true, addFromURL: [] }`), and the client is built to accept
  whatever manifests come back — but whether/how often api.strem.io itself re-fetches a third-party addon's
  manifest from its transport URL **cannot be verified from any open repository**. Treat "server refreshes
  third-party manifests on update:true" as *plausible but unverified*; verify empirically with a logged-in account
  before relying on propagation latency.

- The only other client-side manifest fetch is **on-demand**: opening the addon-details modal loads a
  `DescriptorLoadable` fresh from the transport URL ([`stremio-core/src/models/addon_details.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/models/addon_details.rs),
  rendered by `AddonDetailsModal.js` — "ADDON_LOADING_MANIFEST_FROM ..."). That fresh manifest is only *stored* if
  the user clicks Install (which, per `Internal::InstallAddon`, replaces the existing entry at the same
  `transport_url` in place — an effective "reinstall to update" that does not require uninstalling first when
  dispatched, though the stremio-web UI shows Uninstall rather than a Reinstall button for installed addons).

**Bottom line for the key question**: if we add/remove a catalog in the manifest served at the *same* transport URL —
- logged-in users: the installed addon updates without reinstall **if and when api.strem.io's copy updates**; the
  client picks it up on next app open/focus. Expect "next time Stremio is opened", not real-time, and verify the
  server-side refresh empirically.
- anonymous/local-profile users: it will **not** update until they reinstall (paste URL → Install replaces in
  place).

## 4. Install link formats

- **Deep link (desktop/mobile apps)**: take the full manifest URL and swap the scheme for `stremio://`:
  `stremio://release-notifier.yoshevbot.uk/{token}/manifest.json`
  - Spec'd in [`stremio-addon-sdk/docs/advanced.md`](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/docs/advanced.md#creating-addon-configuration-pages):
    "if your Addon Repository URL is `https://my.addon.com/some-user-data/manifest.json`, the 'Install Addon' button
    should point to `stremio://my.addon.com/some-user-data/manifest.json`".
  - Generated the same way by the SDK itself: [`src/landingTemplate.js`](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/src/landingTemplate.js)
    (`'stremio://' + window.location.host + '/' + ... + '/manifest.json'`) and
    [`src/serveHTTP.js`](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/src/serveHTTP.js)
    (`url.replace('http://', 'stremio://')`).
  - Receiver side ([`stremio-web/src/App/App.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/App/App.js), `onOpenMedia`):
    a `stremio://host/path` URL is rebuilt as `https://${hostname}${pathname}` and routed to
    `/addons?addon=${encodeURIComponent(transportUrl)}`, which opens the install prompt (details modal).
    Note it hardcodes `https://` — the addon **must be reachable over HTTPS** (fine for us).

- **Web installer (current stremio-web, web.stremio.com)**:
  `https://web.stremio.com/#/addons?addon=` + `encodeURIComponent('https://release-notifier.yoshevbot.uk/{token}/manifest.json')`
  - The `addon` query param on the Addons route is read by
    [`src/routes/Addons/useAddonDetailsTransportUrl.js`](https://github.com/Stremio/stremio-web/blob/daf74b0ec973054c94de9f0f8271b3234bd26c43/src/routes/Addons/useAddonDetailsTransportUrl.js)
    (`queryParams.get('addon')`) and feeds `AddonDetailsModal`, which fetches the manifest and shows
    Install/Configure. Same param the deep-link handler above produces.

- **Legacy web installer (app.strem.io shell v4.4)**:
  `https://app.strem.io/shell-v4.4/#?addonOpen=` + `encodeURIComponent(manifestUrl)` — this is what the SDK's
  `--launch` flow uses ([`src/serveHTTP.js`](https://github.com/Stremio/stremio-addon-sdk/blob/2728da3ee853207cd5ee200aabe15a08cc1d01d1/src/serveHTTP.js),
  base `https://app.strem.io/shell-v4.4#` / `https://staging.strem.io#`). Current stremio-web has **no**
  `addonOpen` handler (a code search of the repo finds none), so prefer the `#/addons?addon=` form for new links.

## 5. Identity of an installed addon: transport URL, not manifest.id

[`stremio-core/src/models/ctx/update_profile.rs`](https://github.com/Stremio/stremio-core/blob/eeb89ff8c7f401b50c435933dab399daa956dc35/src/models/ctx/update_profile.rs) —
every membership operation on `profile.addons` keys on `Descriptor.transport_url`:

- `Internal::InstallAddon`: `position(|transport_url| *transport_url == addon.transport_url)` — if an addon with the
  **same transport URL** exists it is replaced in place; otherwise the new descriptor is **pushed alongside**
  whatever else is installed. `manifest.id` is not consulted.
- `Internal::UninstallAddon` and `ActionCtx::UpgradeAddon`: same `position(...)` by `transport_url`.
- The only place `manifest.id` matters is the anonymous-profile official-addon version bump (§3) and event payloads.

**Consequence**: installing the same `manifest.id` from a *different* transport URL (e.g. after token regeneration)
**keeps both** — Stremio ends up with two installed addons with the same id, and the stale one is only removed by an
explicit uninstall. Corroborating (community/real-world, clearly labeled as such):
[stremio-addon-sdk issue #271](https://github.com/Stremio/stremio-addon-sdk/issues/271) is an open feature request
complaining about exactly this — a changed URL (rotated token) is treated as a separate addon, with no
"same-id replaces" behavior.

---

## Implications for our addon (#109)

1. **Manifest flags.** Serve the token'd manifest (`/{token}/manifest.json`) with
   `behaviorHints: { configurable: true }` — installed users get a gear button that opens our page. If we also serve
   a bare `/manifest.json` (public/marketing entry point), give it `configurationRequired: true` so Stremio shows
   only "Configure" (install is blocked by stremio-core itself) and funnels users to `/configure`.
2. **Routes the Worker must serve.** `GET /{token}/configure` is non-negotiable — Stremio builds it by string-replacing
   the trailing `manifest.json` of the installed transport URL. Also serve bare `/configure` (target of the
   `configurationRequired` flow and the SDK-documented landing convention). Extend the Worker's `run_worker_first`
   route list accordingly (today it only forces `/manifest.json` + `/catalog/movie/*`).
3. **Live-edit vs reinstall messaging.** Catalog add/remove at the same token URL is *not* instant: for logged-in
   Stremio users it propagates via the api.strem.io collection sync, picked up on app open/window focus (server-side
   refresh cadence unverifiable — test empirically); for anonymous profiles it never propagates. UX copy should say
   "changes apply automatically the next time you open Stremio" and offer a "reinstall" install-link as the
   guaranteed path (Install at the same URL replaces the stored manifest in place — no uninstall needed).
4. **Token-regenerate UX.** A new token = a new transport URL = a *second* installed addon; the old one lingers and
   breaks. On regeneration: (a) tell the user explicitly to uninstall the old entry (or open Stremio's addons page
   for them), and (b) have the Worker answer old tokens gracefully (valid manifest, empty catalogs, maybe a
   "reconfigure me" catalog row) rather than 404, so the stale install degrades politely. Keeping `manifest.id`
   stable does NOT dedupe installs.
5. **Links to emit.** App deep link: `stremio://release-notifier.yoshevbot.uk/{token}/manifest.json`. Web fallback:
   `https://web.stremio.com/#/addons?addon=<urlencoded https manifest URL>`. Avoid the legacy `?addonOpen=` form.
   HTTPS is mandatory (the deep-link handler rebuilds the URL as `https://`).
6. **Token hygiene.** The token path segment must never contain the substring `manifest.json` (naive first-occurrence
   `String.replace` builds the Configure URL) — any URL-safe random token is fine.
