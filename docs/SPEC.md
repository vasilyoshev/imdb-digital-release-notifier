# IMDb Digital Release Notifier — Build Spec (Netlify + Supabase rework)

**Status: build-ready.** Produced by the wayfinder effort ([map issue #1](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/1)). Every decision below was resolved in a linked ticket; this document is the assembly. The current code in this repo informs intent only — it is **not** a template. Domain terms used here are defined in [`CONTEXT.md`](../CONTEXT.md) (the ubiquitous language); this spec uses them without redefining them.

> **Amended 2026-07-15** (post-map, per Vasil): (1) **Lists are first-class** — the IMDb watchlist and a TMDb-Discover “Popular” list are two rows of one generic lists model, each with its own sync and notification toggles; movie identity generalizes to IMDb-or-TMDb. (2) **Supabase is self-hosted** — no cloud project; development runs against a local Docker stack (`supabase start`), and the self-host deployment is a separate follow-up effort.

**Out of scope** (declined at charting): multi-user support, watched/dismissed item states, IMDb login-based access to private watchlists.

---

## 1. Product summary

Single-user personal tool that tracks theatrical and digital releases for movies on **auto-synced lists** — Vasil's public IMDb watchlist and a “Popular” list fed by TMDb Discover — and announces them. One dashboard (PWA), email digests, web push. No signups — exactly one account.

## 2. Architecture

| Piece | Choice |
|---|---|
| Frontend | Static **Vite + React SPA**, PWA, hosted on **Netlify**. No server runtime on Netlify. |
| Backend | **Supabase, self-hosted** (Docker): Postgres, Auth (one account, signups disabled), one **Edge Function** (Deno) running the whole pipeline, **pg_cron + pg_net** scheduling. Development targets a local `supabase start` stack; self-host deployment is a follow-up task. |
| Release data | **TMDb only** (MDBList dropped). Region order **BG → US → GB**. |
| List sources | IMDb's unauthenticated **GraphQL API** (watchlist, unofficial) + **TMDb Discover** (popular list, filter-driven). |
| Email | **Resend** (HTTP API, custom domain `yoshevbot.uk`). Fallback candidate: Postmark. |
| Push | Web Push from the Edge Function via **`jsr:@negrel/webpush`**. |

Flow: pg_cron (hourly) → Edge Function gate check (run only when the current Europe/Sofia hour = `settings.notify_hour`) → Refresh Run: sync each sync-enabled list (IMDb watchlist / TMDb Discover) → match/merge movie identities → refresh dates+providers for every movie with an active membership → compute effective dates → detect Release Events → append `notification_log` → send digest email + pushes for notify-eligible events. The dashboard's **Refresh now** button invokes the same function and bypasses the gate; dedupe makes double runs safe.

## 3. List ingestion

### 3a. IMDb watchlist (kind `imdb_watchlist`)

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
        } } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  ```

  Paginate with `first: 250`, follow `endCursor` (note `$after` is typed `ID`, not `String`). Verified on a real 216-item list: one ~40 KB response in <1 s.
- **Fallback only:** GET the watchlist HTML and parse `__NEXT_DATA__` (`props.pageProps.mainColumnData.predefinedList.titleListItemSearch`, same shape). `www.imdb.com` sits behind an AWS WAF JS challenge, so this can fail hard from datacenter IPs. The old CSV export endpoint is dead (login-only now).
- **Input parsing (settings):** extract `ur\d+` from any pasted profile/watchlist URL, or accept a bare `ur…` id; stored in the list row's `config.imdb_user_id`. The opaque `/user/p.xxxx/` slug URLs cannot be resolved without HTML — reject them with guidance to paste the `ur…` form. (Vasil's id: `ur27331503`.)
- **Private list** → GraphQL `FORBIDDEN` error → surface “set your watchlist to public” in the UI.
- **Scope filter:** only movies enter the domain — skip series/games at sync via `titleType`; never stored.
- **Compliance:** unofficial API, personal non-commercial use per the disclaimer in every response. Isolate the query in one module so breakage is contained.

### 3b. Popular list (kind `tmdb_discover`)

*Added by the 2026-07-15 amendment.*

- **Method:** `GET https://api.themoviedb.org/3/discover/movie` with the list row's `config.filters` passed through as query params (whitelisted keys: `sort_by`, `vote_count.gte`, `vote_average.gte`, `with_genres`, `without_genres`, `primary_release_date.gte`, `primary_release_date.lte`, `with_original_language`, `region`, `with_release_type`) plus `config.limit` (default **50**) controlling how many top results are kept (pages of 20 — fetch ⌈limit/20⌉ pages).
- **Default config:** `{"filters": {"sort_by": "popularity.desc", "vote_count.gte": 100}, "limit": 50}` — editable in settings (the filters are the “based on some filter” knobs).
- Discover returns **TMDb ids**; the movie's IMDb id arrives via `external_ids` in the per-movie bundle call (§4) and may legitimately stay NULL.
- List churn is expected: titles dropping off the chart get their membership soft-removed (never deleted); titles returning get it restored.

## 4. TMDb integration

*Decided in [#3](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/3); full findings: [`docs/research/tmdb-coverage.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/tmdb-coverage/docs/research/tmdb-coverage.md).*

- **Mapping (watchlist movies):** `/find/{imdb_id}`, one call per title, no batch form. Read `movie_results` specifically; empty result = Unmatched Movie, kept and retried every run.
- **Per-movie refresh:** `GET /movie/{tmdb_id}?append_to_response=release_dates,watch/providers,external_ids` — details + dates + providers + IMDb id in **one call**; ~270 calls/day for ~216 watchlist + 50 popular titles (~7 s at full rate).
- **Release dates:** all countries in one response; type **3 = Theatrical**, type **4 = Digital**; ignore premiere/limited/physical/TV; earliest date wins per (region, medium). Community-edited — BG digital dates are often missing (US type-4 best populated), and dates are mutable between runs; the BG → US → GB fallback is essential and pure client-side logic.
- **Providers:** JustWatch-powered; BG supported with `flatrate`/`rent`/`buy`/`ads`/`free`. No deep links — link via the returned `link` URL.
- **Auth & limits:** v4 Read Access Token as `Authorization: Bearer`; ~40 req/s ceiling, respect 429s. Free for non-commercial use; cached content max 6 months.
- Optional optimization (not required): intersect `/movie/changes` with tracked movies to re-fetch fewer titles.

## 5. Database schema

*Decided in [#7](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/7), amended 2026-07-15 for the lists model. All tables RLS-enabled (§10). Movies only.*

**`movies`** — one row per film ever tracked, **never deleted**.
- `id bigint identity PK` (surrogate — needed because identity may arrive from either side); `imdb_id text UNIQUE NULL` (`tt…`), `tmdb_id int UNIQUE NULL`; CHECK at least one is non-NULL. Watchlist movies enter with `imdb_id` (Unmatched until `/find` succeeds); Popular movies enter with `tmdb_id` (IMDb id filled from `external_ids` when available).
- **Merge rule:** when a mapping reveals that an imdb-only row and a tmdb-keyed row are the same film, merge into the richer row and repoint children. An imdb-only stub has no dates and therefore no log rows by construction, so the merge is conflict-free.
- Cached display metadata: `title`, `year`, `poster_path`.
- Computed effective dates (post region-fallback): `theatrical_date`, `theatrical_region`, `digital_date`, `digital_region`.

**`lists`** — the auto-synced lists, seeded with two rows (Watchlist, Popular).
- `(id int identity PK, kind text CHECK IN ('imdb_watchlist','tmdb_discover'), name text, position int, sync_enabled bool DEFAULT true, notifications_enabled bool DEFAULT true, config jsonb DEFAULT '{}', created_at)`.
- `sync_enabled = false` freezes the list's membership (no sync); its movies keep refreshing while they hold an active membership somewhere.
- `notifications_enabled` gates delivery, not detection (§7).
- `config`: watchlist → `{"imdb_user_id": "ur…"}`; discover → `{"filters": {…}, "limit": 50}` (§3b).
- The model deliberately supports more rows later (more discover presets, other IMDb public lists) without schema change.

**`list_memberships`** — soft membership per list, never deleted.
- `(list_id FK, movie_id FK, on_list bool, added_at, removed_at)`, PK `(list_id, movie_id)`. Dropping off a list flips `on_list = false`; returning flips it back. A movie is **active** iff it has `on_list = true` on any list; only active movies are refreshed, shown by default, and eligible for delivery.

**`release_dates`** — raw fetched truth, overwritten each Refresh Run. `(movie_id FK, region, medium, release_date)`, PK `(movie_id, region, medium)`; BG/US/GB × theatrical/digital. Kept for provenance and to make the fallback auditable. Never notified from directly.

**`watch_providers`** — `(movie_id FK, region, provider_id, offer_type, provider_name, logo_path, display_priority, link)`, PK `(movie_id, region, provider_id, offer_type)`. All 3 regions, all offer types. Overwritten each run.

**`notification_log`** — **append-only, never pruned** (it *is* the dedupe state).
- `(id, movie_id FK, medium, event ∈ {announced, released, date_changed}, effective_date, sent_at timestamptz NULL, created_at)`.
- `sent_at NULL` = Seeded Event (past fact at first observation), produced while Paused, **or produced while no containing list had notifications enabled**: counts as notified for dedupe, never re-sent, hidden from history.
- Partial unique index on `(movie_id, medium, event) WHERE event != 'date_changed'` enforces once-ever announced/released — global per movie, so a movie on both lists notifies once.
- Doubles as the UI's reverse-chronological **History feed** (seeded rows excluded).

**`push_subscriptions`** — `(id, endpoint UNIQUE, p256dh, auth, created_at)`. UI inserts/deletes; pipeline deletes on 404/410.

**`settings`** — singleton row: `region_order text[]` default `{BG,US,GB}` (editable), `notify_email` (editable, defaults to the account email), `notifications_paused bool` (global), `notify_hour int` default 9 (Europe/Sofia). Per-list source config lives on `lists.config`, not here.

**`refresh_runs`** — kept forever: `(id, trigger ∈ {cron, manual}, started_at, finished_at, status, counts…, error)`.

**Derived statuses** (UI language, never stored): Unmatched → Waiting → Announced → In theaters → Out now.

## 6. Refresh pipeline (the Edge Function)

One function runs everything, in order:

1. **Gate** (cron trigger only): exit immediately unless current Europe/Sofia hour = `settings.notify_hour`. Manual trigger bypasses.
2. Open a `refresh_runs` row recording the trigger.
3. **Sync each `sync_enabled` list**: watchlist via IMDb GraphQL (§3a), popular via TMDb Discover (§3b). New films insert `movies` rows; membership flips per list (`on_list` true/false, never delete). Sync-disabled lists are skipped wholesale.
4. **Resolve identities**: `/find/{imdb_id}` for active imdb-only movies; apply the merge rule (§5) when identities collide.
5. For each **active** movie with a `tmdb_id`: one TMDb bundle call (§4); overwrite `release_dates` and `watch_providers`; refresh cached metadata and fill `imdb_id` from `external_ids`; recompute effective dates by walking `settings.region_order`.
6. **Detect Release Events** (§7) against the notification log; append rows. Events are **silent** (`sent_at NULL`) when seeded, when globally Paused, or when no list containing the movie has `notifications_enabled`.
7. **Deliver** non-silent events (§8): one email digest + one push per event; stamp `sent_at`.
8. Prune push subscriptions that returned 404/410.
9. Close the `refresh_runs` row with status, counts, and any error.

Edge Function limits are a non-issue: one GraphQL call + ~3 discover pages + ~270 TMDb calls + a handful of sends. `EdgeRuntime.waitUntil` is available if needed.

## 7. Notification semantics

*Decided in [#6](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/6). All rules operate on **effective dates** only.*

**Five event kinds:**
- `theatrical_announced`, `digital_announced` — a future effective date first appears.
- `theatrical_released`, `digital_released` — fire when the effective date is **≤ today on first observation** (not exact-match equality, so backfilled/slipped dates can't silently skip the “out now”).
- `date_changed` — an already-notified date moves, **both directions**. Only fires between announcement and release: never for dates never notified, never after the corresponding `*_released` went out. Defined on the effective date — BG data appearing that matches the US date already known is silent.

**Dedupe (against the append-only log, global per movie):**
- `*_announced` / `*_released`: at most **once per (movie, medium), ever** — survives list remove-and-re-add, and being on multiple lists notifies once.
- `date_changed`: fires iff the current effective date ≠ the **last date logged** for that (movie, medium) — compared against the log, not yesterday's snapshot. A flap A → B → A across days correctly re-notifies the return to A; intra-day churn is invisible.
- **Same-run precedence:** if a date first appears already in the past, only `*_released` fires — the announcement (and any pending `date_changed`) is suppressed for that medium.

**Delivery gating (amendment):** detection always runs and always logs; a detected event is **delivered** only if the movie sits on at least one `notifications_enabled` list and global Pause is off. Otherwise the row is written silent (`sent_at NULL`) — so toggling notifications on later does not flood past events.

**Bootstrap — one uniform new-title rule (no special first-sync mode):** when a title is first observed, events whose dates are already past are **seeded silently** (`sent_at NULL`); only present/future facts notify. First-ever sync (~216 watchlist + 50 popular titles) therefore produces **zero notifications**. Adding an old, already-released movie later → silent. Accepted edge: a movie released yesterday, added today, gets no ping.

## 8. Notification channels

**Email — Resend** (*decided in [#5](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/5); comparison: [`docs/research/email-provider.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/email-provider/docs/research/email-provider.md)*):
- **One digest per Refresh Run** — all of the run's delivered events in one message, grouped by kind (out now / dates announced / dates changed). Zero-event runs send nothing.
- Single JSON POST with a Bearer key from Deno `fetch`; sender on `yoshevbot.uk` (Resend has a first-party Cloudflare DNS guide). Free tier: 3,000/mo, 100/day, one custom domain. Until the domain is verified, `onboarding@resend.dev` can send to the account owner's own address.

**Web push** (*decided in [#4](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/4); full findings: [`docs/research/web-push-supabase.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/web-push-supabase/docs/research/web-push-supabase.md)*):
- **One notification per event**, tappable through to the title. Same events as email, different packaging — no per-channel filtering.
- Library: **`jsr:@negrel/webpush`** (WebCrypto-only RFC 8291/8292) — not `npm:web-push`.
- **VAPID:** generate an ECDSA P-256 pair once (`generateVapidKeys` → `exportVapidKeys` JWK JSON); store as one secret `VAPID_KEYS_JSON`, read with `Deno.env.get`; the base64url public key (`exportApplicationServerKey`) ships in the frontend.
- **Client:** subscribe from a click handler with `{ userVisibleOnly: true, applicationServerKey }`; upsert `subscription.toJSON()` (`endpoint`, `keys.p256dh`, `keys.auth`) into `push_subscriptions` (unique on `endpoint`).
- **Pruning:** delete rows on 404/410 send responses; do not rely on `pushsubscriptionchange` (broken in Chrome).
- **iOS:** requires iOS/iPadOS 16.4+ **and** the PWA installed to the Home Screen; permission only from a user tap; every push must show a notification or Safari revokes the subscription.

## 9. Frontend — the “Console” dashboard

*Decided in [#8](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/8) (Variant A). Primary visual reference: branch [`prototype-dashboard-ui`](https://github.com/vasilyoshev/imdb-digital-release-notifier/tree/prototype-dashboard-ui), route `/prototype/dashboard?variant=A`, screenshots in `docs/prototype/`. The winner gets rebuilt properly in the new SPA, not copied; variants B and C are reference only.*

- **Single-screen dashboard.** Navbar: app name · last-run summary · **Refresh now** · settings gear · account menu (email + sign out).
- **List switcher** (amendment): a segmented control above the table — **Watchlist | Popular** (one segment per list row, ordered by `position`) — scoping the stat-strip and table to that list.
- **Status stat-strip** (Out now / In theaters / Announced / Waiting / Unmatched) that click-filters the table.
- **Dense watchlist table**: poster, title+year, status badge, theatrical date, digital date — each date with its sourcing-region superscript — and BG provider chips.
- **Right side rail, two tabs:** **Upcoming** — a vertical timeline of announced effective dates across all active movies; this *is* the calendar feature (no month grid, no separate calendar page). **History** — the notification log, reverse-chronological, seeded rows hidden (no separate page).
- **Settings modal** (behind the gear): global card (notification email, region order, gate hour, global pause, push-device management) + **one card per list** (amendment): sync toggle, notifications toggle, and the list's source config — watchlist URL for the IMDb list, discover filters + limit for the Popular list.
- **PWA install = dismissible top banner.** With `beforeinstallprompt`, the Install button triggers the native prompt; on iOS the banner shows Share → Add to Home Screen steps instead.
- **Mobile:** the table collapses to stacked cards; stat strip and side rail stack vertically below. Same single page, responsive — no separate mobile navigation.
- **Offline: online-only.** The service worker (required for push anyway) caches the app shell so it opens instantly; data always needs network.
- **Service worker:** vite-plugin-pwa **`injectManifest`** strategy with a custom `sw.ts` (`push` + `notificationclick` listeners).
- **Attribution** (required, see §12): TMDB and JustWatch notices in the UI footer/about.

## 10. Auth & RLS

- Supabase Auth, **one account** (Vasil), **signups disabled** after creating it. Login is the only unauthenticated view.
- **Role-based RLS, no owner columns:** the `authenticated` role gets SELECT on all tables; INSERT/UPDATE/DELETE only on `settings`, `push_subscriptions`, and (amendment) UPDATE on `lists` (toggles + config). Membership rows are pipeline-owned. With signups disabled there is exactly one possible authenticated user.
- The pipeline uses the **service role**.

## 11. Scheduling

**Hourly pg_cron + gate check.** Cron (via pg_net) invokes the Edge Function every hour; it exits unless the current Europe/Sofia hour equals `settings.notify_hour` (default 9). Changing send time is a row update — no cron surgery, DST-safe. Manual refresh bypasses the gate. Every run records its trigger in `refresh_runs`.

## 12. Compliance & attribution

- **TMDB:** attribution + logo + “not endorsed or certified by TMDB” notice; cached content max 6 months.
- **JustWatch:** mandatory attribution wherever provider data is shown (access revoked otherwise).
- **IMDb:** unofficial GraphQL API, personal non-commercial use; keep the query isolated in one module.

## 13. Provisioning & environments

*Rewritten by the 2026-07-15 amendment: no Supabase cloud project.*

**Development (now):** local Supabase stack via the CLI — `supabase init` + `supabase start` (Docker; installed as npm dev-deps `supabase` and `deno`). Migrations, Edge Function, and E2E verification all run locally. Secrets for local runs live in `supabase/functions/.env` (gitignored): `TMDB_BEARER` (already in hand), `RESEND_API_KEY`, `VAPID_KEYS_JSON`.

**Deployment (separate follow-up effort):** self-hosted Supabase (Docker Compose) on infrastructure of Vasil's choosing — to be provisioned when the build is done. Needs: Postgres + Auth (`GOTRUE_DISABLE_SIGNUP=true` after creating the account) + edge-runtime (functions) + pg_cron/pg_net; Netlify site pointed at the self-hosted URL. The checklist below carries over:

1. **TMDb** ✓ — v4 Read Access Token already exists (repo `.env.local`).
2. **Resend** — create the account; interim sending via `onboarding@resend.dev` to Vasil's own email; verify `yoshevbot.uk` (Cloudflare DNS records per Resend's guide) for the real sender; API key into function secrets.
3. **VAPID** — generate once with `@negrel/webpush` (script in repo); `VAPID_KEYS_JSON` into function secrets; public application-server key into frontend env.
4. **Auth** — create Vasil's account (email + password), then disable signups.
5. **Cron** — schedule the hourly pg_cron job invoking the function with the service-role key (from Vault on self-hosted).
6. **Netlify** — create the site from this repo (Vite build, SPA fallback redirect); env: Supabase URL, anon key, VAPID public key.
7. **First run** — sign in, confirm the seeded lists (watchlist `ur27331503`, Popular defaults), hit Refresh now. Expected: both lists ingested, **zero notifications** (everything seeds silently).

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
| Amendment 2026-07-15 | First-class lists (Watchlist + TMDb-Discover Popular, per-list sync/notify toggles); movie identity imdb-or-tmdb with merge rule; delivery gating per list; self-hosted Supabase (local Docker for dev) |
