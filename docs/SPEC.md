# IMDb Digital Release Notifier — Build Spec (Netlify + Supabase rework)

**Status: build-ready.** Produced by the wayfinder effort ([map issue #1](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/1)). Every decision below was resolved in a linked ticket; this document is the assembly. The current code in this repo informs intent only — it is **not** a template. Domain terms used here are defined in [`CONTEXT.md`](../CONTEXT.md) (the ubiquitous language); this spec uses them without redefining them.

**Out of scope** (declined at charting): multi-user support, watched/dismissed item states, IMDb login-based access to private watchlists.

---

## 1. Product summary

Single-user personal tool that watches Vasil's public IMDb watchlist and announces theatrical and digital releases. One dashboard (PWA), email digests, web push. No signups — exactly one account.

## 2. Architecture

| Piece | Choice |
|---|---|
| Frontend | Static **Vite + React SPA**, PWA, hosted on **Netlify**. No server runtime on Netlify. |
| Backend | **Supabase**: Postgres, Auth (one account, signups disabled), one **Edge Function** (Deno) running the whole pipeline, **pg_cron + pg_net** scheduling. |
| Release data | **TMDb only** (MDBList dropped). Region order **BG → US → GB**. |
| Watchlist source | IMDb's unauthenticated **GraphQL API** (unofficial). |
| Email | **Resend** (HTTP API, custom domain `yoshevbot.uk`). Fallback candidate: Postmark. |
| Push | Web Push from the Edge Function via **`jsr:@negrel/webpush`**. |

Flow: pg_cron (hourly) → Edge Function gate check (run only when the current Europe/Sofia hour = `settings.notify_hour`) → Refresh Run: fetch watchlist → match/refresh via TMDb → compute effective dates → detect Release Events → append `notification_log` → send digest email + pushes. The dashboard's **Refresh now** button invokes the same function and bypasses the gate; dedupe makes double runs safe.

## 3. Watchlist ingestion (IMDb)

*Decided in [#2](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/2); full findings: [`docs/research/imdb-watchlist-fetch.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/imdb-watchlist-fetch/docs/research/imdb-watchlist-fetch.md).*

- **Method:** `POST https://api.graphql.imdb.com/` (or the faster `caching.graphql.imdb.com`) — no browser, no auth, no cookies:

  ```graphql
  query WL($userId: ID!, $first: Int!, $after: ID) {
    predefinedList(classType: WATCH_LIST, userId: $userId) {
      id
      items(first: $first, after: $after) {
        total
        edges { node { listItem { ... on Title {
          id titleText { text } releaseYear { year } titleType { id }
          releaseDate { day month year }
        } } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  ```

  Paginate with `first: 250`, follow `endCursor` (note `$after` is typed `ID`, not `String`). Verified on a real 216-item list: one ~40 KB response in <1 s — trivially within Edge Function limits.
- **Fallback only:** GET the watchlist HTML and parse `__NEXT_DATA__` (`props.pageProps.mainColumnData.predefinedList.titleListItemSearch`, same shape). `www.imdb.com` sits behind an AWS WAF JS challenge, so this can fail hard from datacenter IPs. The old CSV export endpoint is dead (login-only now).
- **Input parsing (settings page):** extract `ur\d+` from any pasted profile/watchlist URL, or accept a bare `ur…` id. The opaque `/user/p.xxxx/` slug URLs cannot be resolved without HTML — reject them with guidance to paste the `ur…` form.
- **Private list** → GraphQL `FORBIDDEN` error → surface “set your watchlist to public” in the UI.
- **Scope filter:** only movies enter the domain — skip series/games at sync via `titleType`; never stored.
- **Compliance:** unofficial API, personal non-commercial use per the disclaimer in every response. Isolate the query in one module so breakage is contained.

## 4. TMDb integration

*Decided in [#3](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/3); full findings: [`docs/research/tmdb-coverage.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/tmdb-coverage/docs/research/tmdb-coverage.md).*

- **Mapping:** `/find/{imdb_id}`, one call per title, no batch form. Read `movie_results` specifically; empty result = Unmatched Movie, kept and retried every run.
- **Per-movie refresh:** `GET /movie/{tmdb_id}?append_to_response=release_dates,watch/providers` — details + dates + providers in **one call**; ~200 calls/day for the current list size (~5 s at full rate).
- **Release dates:** all countries in one response; type **3 = Theatrical**, type **4 = Digital**; ignore premiere/limited/physical/TV. Community-edited — BG digital dates are often missing (US type-4 best populated), and dates are mutable between runs; the BG → US → GB fallback is essential and pure client-side logic.
- **Providers:** JustWatch-powered; BG supported with `flatrate`/`rent`/`buy`/`ads`/`free`. No deep links — link via the returned `link` URL.
- **Auth & limits:** v4 Read Access Token as `Authorization: Bearer`; ~40 req/s ceiling, respect 429s. Free for non-commercial use; cached content max 6 months.
- Optional optimization (not required): intersect `/movie/changes` with the watchlist to re-fetch fewer titles.

## 5. Database schema

*Decided in [#7](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/7). All tables RLS-enabled (§10). Movies only.*

**`movies`** — one row per watchlist film, **never deleted**.
- `imdb_id text PK` (`tt…`), `tmdb_id int UNIQUE NULL` (NULL = Unmatched, retried every run).
- Cached display metadata: `title`, `year`, `poster_path` (add fields as the UI needs).
- Computed effective dates (post region-fallback): `theatrical_date`, `theatrical_region`, `digital_date`, `digital_region`.
- Soft membership: `on_watchlist bool`, `added_at`, `removed_at`. Disappearing from the watchlist flips the flag: no refresh spend, hidden from UI, no notifications. Re-adding flips it back; once-ever dedupe survives because log rows stay attached.

**`release_dates`** — raw fetched truth, overwritten each Refresh Run. `(imdb_id FK, region, medium, release_date)`, PK `(imdb_id, region, medium)`; BG/US/GB × theatrical/digital. Kept for provenance (“US date, BG not announced”) and to make the fallback auditable. Never notified from directly.

**`watch_providers`** — `(imdb_id FK, region, provider_id, offer_type, provider_name, logo_path, display_priority, link)`, PK `(imdb_id, region, provider_id, offer_type)`. All 3 regions, all offer types (same API call) — enables “not in BG, but on Max in US”. Overwritten each run.

**`notification_log`** — **append-only, never pruned** (it *is* the dedupe state; deleting rows would resurrect notifications).
- `(id, imdb_id FK, medium, event ∈ {announced, released, date_changed}, effective_date, sent_at timestamptz NULL, created_at)`.
- `sent_at NULL` = Seeded Event (past fact at first observation, or produced while Paused): counts as notified for dedupe, never re-sent, hidden from history.
- Partial unique index on `(imdb_id, medium, event) WHERE event != 'date_changed'` enforces once-ever announced/released.
- Doubles as the UI's reverse-chronological **History feed** (seeded rows excluded).

**`push_subscriptions`** — `(id, endpoint UNIQUE, p256dh, auth, created_at)`. UI inserts/deletes; pipeline deletes on 404/410.

**`settings`** — singleton row: `watchlist_url`, derived `imdb_user_id` (`ur…`), `region_order text[]` default `{BG,US,GB}` (editable), `notify_email` (editable, defaults to the account email), `notifications_paused bool`, `notify_hour int` default 9 (Europe/Sofia).

**`refresh_runs`** — kept forever: `(id, trigger ∈ {cron, manual}, started_at, finished_at, status, counts…, error)`.

**Derived statuses** (UI language, never stored): Unmatched → Waiting → Announced → In theaters → Out now.

## 6. Refresh pipeline (the Edge Function)

One function runs everything, in order:

1. **Gate** (cron trigger only): exit immediately unless current Europe/Sofia hour = `settings.notify_hour`. Manual trigger bypasses.
2. Open a `refresh_runs` row recording the trigger.
3. **Fetch watchlist** (§3). Update soft membership: new ids insert movies, missing ids flip `on_watchlist = false` (never delete), returning ids flip it back.
4. **Retry mapping** for every Unmatched on-watchlist movie via `/find/{imdb_id}`.
5. For each matched, on-watchlist movie: one TMDb call (§4); overwrite `release_dates` and `watch_providers`; refresh cached metadata; recompute effective dates by walking `settings.region_order`.
6. **Detect Release Events** (§7) against the notification log; append rows.
7. **Deliver** (§8) unless Paused — Paused runs still refresh data and append log rows with `sent_at NULL`.
8. Prune push subscriptions that returned 404/410.
9. Close the `refresh_runs` row with status, counts, and any error.

Edge Function limits are a non-issue: 2 s CPU (async I/O excluded) / 150–400 s wall clock vs. one GraphQL call + ~200 TMDb calls + a handful of sends. `EdgeRuntime.waitUntil` is available if needed.

## 7. Notification semantics

*Decided in [#6](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/6). All rules operate on **effective dates** only.*

**Five event kinds:**
- `theatrical_announced`, `digital_announced` — a future effective date first appears.
- `theatrical_released`, `digital_released` — fire when the effective date is **≤ today on first observation** (not exact-match equality, so backfilled/slipped dates can't silently skip the “out now”).
- `date_changed` — an already-notified date moves, **both directions**. Only fires between announcement and release: never for dates never notified, never after the corresponding `*_released` went out. Defined on the effective date — BG data appearing that matches the US date already known is silent.

**Dedupe (against the append-only log):**
- `*_announced` / `*_released`: at most **once per (movie, medium), ever** — survives watchlist remove-and-re-add.
- `date_changed`: fires iff the current effective date ≠ the **last date notified** for that (movie, medium) — compared against the log, not yesterday's snapshot. A flap A → B → A across days correctly re-notifies the return to A; intra-day churn is invisible.
- **Same-run precedence:** if a date first appears already in the past, only `*_released` fires — the announcement (and any pending `date_changed`) is suppressed for that medium.

**Bootstrap — one uniform new-title rule (no special first-sync mode):** when a title is first observed, events whose dates are already past are **seeded silently** (`sent_at NULL`); only present/future facts notify. First-ever sync (~216 titles) therefore produces **zero notifications**. Adding an old, already-released movie later → silent. Accepted edge: a movie released yesterday, added today, gets no ping.

## 8. Notification channels

**Email — Resend** (*decided in [#5](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/5); comparison: [`docs/research/email-provider.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/email-provider/docs/research/email-provider.md)*):
- **One digest per Refresh Run** — all of the run's sent events in one message, grouped by kind (out now / dates announced / dates changed). Zero-event runs send nothing.
- Single JSON POST with a Bearer key from Deno `fetch`; sender on `yoshevbot.uk` (Resend has a first-party Cloudflare DNS guide). Free tier: 3,000/mo, 100/day, one custom domain — ~100× headroom.

**Web push** (*decided in [#4](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/4); full findings: [`docs/research/web-push-supabase.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/web-push-supabase/docs/research/web-push-supabase.md)*):
- **One notification per event**, tappable through to the title. Same events as email, different packaging — no per-channel filtering. Realistic volume 0–3/day; no collapse threshold.
- Library: **`jsr:@negrel/webpush`** (WebCrypto-only RFC 8291/8292) — not `npm:web-push` (unverified on Supabase's Deno runtime, drags Node polyfills).
- **VAPID:** generate an ECDSA P-256 pair once (`generateVapidKeys` → `exportVapidKeys` JWK JSON); store as one secret `VAPID_KEYS_JSON` (`supabase secrets set`), read with `Deno.env.get`; the base64url public key (`exportApplicationServerKey`) ships in the frontend.
- **Client:** subscribe from a click handler with `{ userVisibleOnly: true, applicationServerKey }`; upsert `subscription.toJSON()` (`endpoint`, `keys.p256dh`, `keys.auth`) into `push_subscriptions` (unique on `endpoint`).
- **Pruning:** delete rows on 404/410 send responses; do not rely on `pushsubscriptionchange` (broken in Chrome).
- **iOS:** requires iOS/iPadOS 16.4+ **and** the PWA installed to the Home Screen; permission only from a user tap; every push must show a notification or Safari revokes the subscription.

## 9. Frontend — the “Console” dashboard

*Decided in [#8](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/8) (Variant A). Primary visual reference: branch [`prototype-dashboard-ui`](https://github.com/vasilyoshev/imdb-digital-release-notifier/tree/prototype-dashboard-ui), route `/prototype/dashboard?variant=A`, screenshots in `docs/prototype/`. The winner gets rebuilt properly in the new SPA, not copied; variants B and C are reference only.*

- **Single-screen dashboard.** Navbar: app name · last-run summary · **Refresh now** · settings gear · account menu (email + sign out).
- **Status stat-strip** (Out now / In theaters / Announced / Waiting / Unmatched) that click-filters the table.
- **Dense watchlist table**: poster, title+year, status badge, theatrical date, digital date — each date with its sourcing-region superscript — and BG provider chips.
- **Right side rail, two tabs:** **Upcoming** — a vertical timeline of announced effective dates; this *is* the calendar feature (no month grid, no separate calendar page). **History** — the notification log, reverse-chronological, seeded rows hidden (no separate page).
- **Settings modal** (behind the gear): watchlist URL, notification email, region order, gate hour, pause toggle, push-device management.
- **PWA install = dismissible top banner.** With `beforeinstallprompt`, the Install button triggers the native prompt; on iOS the banner shows Share → Add to Home Screen steps instead.
- **Mobile:** the table collapses to stacked cards; stat strip and side rail stack vertically below. Same single page, responsive — no separate mobile navigation.
- **Offline: online-only.** The service worker (required for push anyway) caches the app shell so it opens instantly; data always needs network.
- **Service worker:** vite-plugin-pwa **`injectManifest`** strategy with a custom `sw.ts` (`push` + `notificationclick` listeners).
- **Attribution** (required, see §12): TMDB and JustWatch notices in the UI footer/about.

## 10. Auth & RLS

- Supabase Auth, **one account** (Vasil), **signups disabled** after creating it. Login is the only unauthenticated view.
- **Role-based RLS, no owner columns:** the `authenticated` role gets SELECT on all tables; INSERT/UPDATE/DELETE only on `settings` and `push_subscriptions`. With signups disabled there is exactly one possible authenticated user.
- The pipeline uses the **service role**.

## 11. Scheduling

**Hourly pg_cron + gate check.** Cron (via pg_net) invokes the Edge Function every hour; it exits unless the current Europe/Sofia hour equals `settings.notify_hour` (default 9). Changing send time is a row update — no cron surgery, DST-safe. Manual refresh bypasses the gate. Every run records its trigger in `refresh_runs`.

## 12. Compliance & attribution

- **TMDB:** attribution + logo + “not endorsed or certified by TMDB” notice; cached content max 6 months.
- **JustWatch:** mandatory attribution wherever provider data is shown (access revoked otherwise).
- **IMDb:** unofficial GraphQL API, personal non-commercial use; keep the query isolated in one module.

## 13. Provisioning checklist (execution effort)

In order — none of this exists yet:

1. **Supabase project.** Create Vasil's account (email + password), then disable signups. Record project URL, anon key, service-role key.
2. **Schema.** Apply migrations for §5 (tables, indexes, RLS policies). Enable `pg_cron` + `pg_net`; schedule the hourly job invoking the Edge Function.
3. **TMDb.** Create the API account; put the v4 Read Access Token in a Supabase secret.
4. **Resend.** Create the account; verify `yoshevbot.uk` (Cloudflare DNS records per Resend's guide); put the API key in a Supabase secret.
5. **VAPID.** Generate the key pair once (`@negrel/webpush`); `supabase secrets set VAPID_KEYS_JSON=…`; put the public application-server key in the frontend env.
6. **Edge Function.** Deploy; verify a manual invoke end-to-end.
7. **Netlify.** Create the site from this repo (Vite build, SPA fallback redirect); env: Supabase URL, anon key, VAPID public key.
8. **First run.** Sign in, paste the watchlist URL in settings, hit Refresh now. Expected outcome: watchlist fully ingested, **zero notifications** (everything seeds silently).

## 14. Decision record

| Ticket | Decision |
|---|---|
| [#2 Watchlist fetch](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/2) | IMDb unauthenticated GraphQL API; HTML fallback; CSV dead |
| [#3 TMDb coverage](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/3) | TMDb-only stands; one appended call per movie per run |
| [#4 Web push](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/4) | `jsr:@negrel/webpush`; VAPID in one secret; injectManifest SW |
| [#5 Email provider](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/5) | Resend (fallback: Postmark) |
| [#6 Notification semantics](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/6) | Five event kinds; append-only log dedupe; silent seeding |
| [#7 Schema & domain model](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/7) | Schema in §5; language in `CONTEXT.md`; hourly cron + gate |
| [#8 UI prototype](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/8) | Variant A “Console”; branch `prototype-dashboard-ui` |
