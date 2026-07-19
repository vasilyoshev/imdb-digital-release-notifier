# IMDb Digital Release Notifier — Build Spec v2 (public, multi-tenant Console)

**Status: build-ready, awaiting its execution map.** Produced by the wayfinder effort [map #36](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/36) — every decision below was resolved in a linked ticket; this document is the assembly. It supersedes the v1 spec (single-user; see git history and [map #1](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/1)), whose build shipped via [Console map #28](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/28) and is live at **release-notifier.netlify.app** against the self-hosted stack at **api.notifier.yoshevbot.uk**. Sections carried over from v1 unchanged are marked *(v1, stands)*. Domain terms are defined in [`CONTEXT.md`](../CONTEXT.md) (the ubiquitous language, updated to v2 alongside this spec); this spec uses them without redefining them.

**What v2 adds to the live product:** a public **Digital Release Radar** for anonymous visitors · **open signup (Google only)** with per-user watchlist sync, follows, and web push · **search + one-click follow** · a **movie detail side panel** · table **sort + filters** · a public-catalogs **Stremio addon** · ops hardening (**backups**, TMDB quota guardrails).

**Out of scope** (ruled at map #36): TV shows (its own follow-up map — seasons/episodes fork the schema), email notifications for non-owner users, personalized Stremio catalogs, managed-hosting migration (stay self-hosted; revisit on real traction). **Left unspecified:** public landing/SEO (the SPA has no SSR — prerender? meta/OG tags?); pick up during execution or as a follow-up.

---

## 1. Product summary

Public, multi-tenant web app that tracks theatrical and digital movie releases, in three tiers:

- **Anonymous visitors** get the **Digital Release Radar**: recently-released-on-digital + upcoming digital movies with dates, providers, and statuses — region-selectable, with the full table controls (sort, filters, detail panel). No account needed.
- **Signed-in users** (open Google signup): IMDB watchlist sync, a **Followed** list fed by search + one-click follow, region cascade + timezone preferences, **web-push notifications**.
- **The owner** (Vasil): everything above, plus email digests, the full-pipeline refresh trigger, and `refresh_runs` visibility.

Plus a **Stremio addon** ("Digital Release Radar") exposing the two public radar catalogs.

## 2. Architecture

| Piece | Choice |
|---|---|
| Frontend | Static **Vite + React SPA**, PWA, hosted on **Netlify** at `release-notifier.netlify.app` (site renamed 2026-07-16; the `netlify.app` subdomain is the permanent identity even if a custom domain is added later). |
| Stremio addon | One **Netlify Function** on the same site (`/manifest.json`, `/catalog/...`) — the only server runtime on Netlify (§12). |
| Backend | **Supabase, self-hosted** (Docker, on yoshevbot-1) at `api.notifier.yoshevbot.uk`: Postgres, GoTrue Auth (**Google-OAuth-only open signup**, §3), **Edge Functions** (pipeline + `search` + `follow` + `delete-account`), **pg_cron + pg_net** scheduling. |
| Release data | **TMDB only**. Supported regions: a curated app-level set (§4); per-user cascade an ordered subset of it. |
| List sources | IMDb's unauthenticated **GraphQL API** (per-user watchlists) + in-app **follow** (manual lists). TMDb-Discover per-user lists are **dropped** ([#48](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/48)) — the shared Radar replaces them. |
| Email | **AWS SES** (v2 API, SigV4 via `aws4fetch`) — **owner-only** digests from `send.yoshevbot.uk`. No SMTP anywhere in the stack (§3). |
| Push | Web Push from the Edge Function via **`jsr:@negrel/webpush`** — all users. |

**Flow:** detection is global, delivery is per-user. Three cron jobs (§8): a **daily full refresh** (sync all lists, hydrate the movie union once, compute the Radar, detect Movie Events), an **hourly change tick** (re-hydrate only TMDB-reported changes), and an **hourly delivery job** (each user's gate hour in their own timezone). Per-user **Refresh now** and the `follow`/`search` edge functions round out the write paths.

## 3. Users, signup & auth

*Decided in [#46](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/46) on the facts of [#39](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/39); full findings: [`docs/research/open-signup.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/open-signup/docs/research/open-signup.md).*

- **Google-only signup.** "Continue with Google" is the sole signup path — no SMTP, no confirmation emails, no password-reset flow, and Google's bot-gating fronts the stack. The owner's existing email/password **login** keeps working (signup disabled ≠ login disabled). More OAuth providers can be added later without model changes.
- **GoTrue config:** `GOTRUE_DISABLE_SIGNUP=false`, `ENABLE_EMAIL_SIGNUP=false` (GoTrue boots fine with no SMTP; Google-OAuth-only needs none), existing `GOTRUE_EXTERNAL_GOOGLE_*` with redirect URI `https://api.notifier.yoshevbot.uk/auth/v1/callback`, and `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For` behind the proxy.
- **Prerequisite:** publish the GCP OAuth consent screen **"In production"** with only `openid`/`email`/`profile` — no Google verification needed, no user cap. (Currently in Testing mode: 100 hand-listed users, 7-day consent expiry.)
- **Roles:** `profiles.role ∈ {owner, user}` (§7). RLS and the pipeline trust it for owner privileges: email delivery, `refresh_runs` visibility, full-pipeline refresh.
- **First run — light 2-step wizard:** (1) confirm region cascade + timezone, prefilled from the browser; (2) optional IMDB watchlist URL — "or just follow movies from the Radar". Then land on the Radar tab with a hint pointing at search/follow. **Push permission is deliberately not requested during onboarding** — it stays in settings/detail-panel context.
- **Self-serve delete:** "Delete account" in the account menu → confirm → a `delete-account` edge function removes the auth user; FK cascades clear profiles, lists, memberships, settings, push subscriptions, deliveries. Shared movie rows stay.
- **Hardening — rate limits only, no captcha at launch.** GoTrue rate limits (`GOTRUE_RATE_LIMIT_*`) with sane values + per-user quotas on `search`/`follow`/Refresh-now (§8). OAuth-only signup makes captcha near-worthless; Turnstile is a config flag away (`GOTRUE_SECURITY_CAPTCHA_*`) if abuse appears. Disposable-email blocking via the `before_user_created` hook is available if ever needed.

## 4. The Digital Release Radar

*Data decided in [#38](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/38) (findings: [`docs/research/tmdb-radar.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/tmdb-radar/docs/research/tmdb-radar.md)); UX in [#42](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/42).*

- **Engine:** `GET /3/discover/movie?with_release_type=4&region={R}&release_date.gte/lte=…` enumerates "movies with a digital release in region R in the window" directly — no trending/popular/upcoming endpoints needed (they add nothing: popular *is* a discover call; upcoming is theatrical-only). Two windows per region: **recent** (new on digital) and **upcoming**.
- **Trust but verify:** discover's top-level `release_date` is documented as the regional, type-matched date, but live queries returned rows **outside the requested window** (prototype finding, #42) — the radar job must verify each candidate against per-movie `release_dates` hydration before writing it.
- **Computed once, shared by all:** a cron job writes **`radar_entries`** (§7) for every supported region; users, the anonymous page, and the Stremio addon read the table — never TMDB. Per-movie hydration is deduped system-wide via the shared movies cache (`refreshed_at` window), so radar + N watchlists fetch each movie once per cycle.
- **Budget:** ~316 TMDB calls per daily 300-movie refresh (16 discover pages + 300 hydrations) against a ~40 req/s ceiling — trivial; honor 429s.
- **Supported regions:** a curated app-level set (~10–20, seeded with BG/US/GB + majors, extended on request). Each user's cascade is an ordered subset; the pipeline hydrates only the union of regions users actually chose.
- **Anonymous UX — the radar view *is* the Console** (winning prototype Variant A, "Console radar"): same navbar bones (wordmark · region select · **Sign in**), stat strip, the dense movie table with a **New on digital | Upcoming** toggle, right rail carrying the signup CTA + upcoming timeline. Signup reads as unlocking more of the same product. Anonymous region choice is a plain navbar select (localStorage persistence — execution detail).
- **After login the radar stays:** it becomes the built-in first tab of the list switcher — **Radar | Watchlist | Followed** — so signed-in users keep the discovery surface and can follow movies straight from it.
- **Attribution (§16) renders on the public surface itself** — TMDB logo + full notice + JustWatch credit.
- Assets: branch [`prototype-radar-ux`](https://github.com/vasilyoshev/imdb-digital-release-notifier/tree/prototype-radar-ux) (screenshots in `docs/prototype-radar/`). Rebuild properly; don't copy.

## 5. Lists & ingestion

`lists.kind` narrows to **`imdb_watchlist` | `manual`** ([#48](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/48)): the per-user TMDb-Discover "Popular" list is **dropped** — the Radar replaces it, the pipeline loses the per-user discover-sync path entirely (zero per-user TMDB discovery quota), and the migration deletes the owner's Popular list (memberships cascade; shared movie rows, release dates, providers, and event history all stay — history keys off `movie_events`, not the list).

### 5a. IMDb watchlist (kind `imdb_watchlist`, per user) *(v1, stands — now per-user)*

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

  Paginate with `first: 250`, follow `endCursor` (`$after` is typed `ID`, not `String`).
- **Fallback only:** GET the watchlist HTML and parse `__NEXT_DATA__` (same shape); `www.imdb.com` sits behind an AWS WAF JS challenge, so this can fail hard from datacenter IPs. CSV export is dead.
- **Input parsing (settings/wizard):** extract `ur\d+` from any pasted profile/watchlist URL, or accept a bare `ur…` id; stored in the list row's `config.imdb_user_id`. Opaque `/user/p.xxxx/` slugs are rejected with guidance.
- **Private list** → GraphQL `FORBIDDEN` → surface "set your watchlist to public" in the UI.
- **Scope filter:** movies only — skip series/games at sync via `titleType`.
- **Multi-tenant:** watchlist fetches are **staggered** across users with **per-list failure isolation** — one broken watchlist skips that list, never kills the run.
- **Compliance:** unofficial API, personal non-commercial use; keep the query isolated in one module.

### 5b. Followed list (kind `manual`)

- Every user gets an auto-created **"Followed"** manual list at signup (same trigger as `profiles`). **Follow = a membership row in it** — one membership model everywhere; unfollow removes the membership. The follow flow is specified in §11.
- **Multi-list CRUD is deferred:** the model supports more manual lists for free (`kind='manual'`), but v2 ships no list-management UI and no follow-target picker — exactly IMDB-watchlist sync + the Followed list.

## 6. TMDB integration *(v1 core stands; additions marked)*

*Decided in [#3](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/3), extended by [#38](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/38)/[#41](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/41)/[#44](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/44).*

- **Mapping (watchlist movies):** `/find/{imdb_id}`, one call per title; empty result = Unmatched Movie, kept and retried.
- **Per-movie refresh:** `GET /movie/{tmdb_id}?append_to_response=release_dates,watch/providers,external_ids` — one call per movie per cycle, **shared across all users** (hydrate the union once; dedupe via the `refreshed_at` window). **New:** the same response fills `movies.genres` (zero extra API cost). Trailer video data is *not* part of the standard bundle — the detail view fetches `videos` on demand or the execution map appends it (execution detail).
- **Release dates:** all countries in one response; type **3 = Theatrical**, type **4 = Digital**; ignore premiere/limited/physical/TV; earliest date wins per (region, medium). Dates are community-edited and mutable; the per-user region cascade is pure client-of-the-data logic.
- **Providers:** JustWatch-powered `flatrate`/`rent`/`buy`/`ads`/`free`; link via the returned `link` URL only.
- **Changes tick (new, promoted from v1's optional note):** hourly, intersect `/movie/changes` with tracked movies and re-hydrate only those (~30–50 calls).
- **Auth & limits:** v4 Read Access Token as Bearer; ~40 req/s ceiling, respect 429s (back off and defer, §8). Free for non-commercial use; the app must stay revenue-free; cached content max 6 months (irrelevant at daily cadence).

## 7. Database schema (v2)

*Decided in [#40](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/40) (+ `genres` from [#44](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/44), `timezone` + `refresh_runs` changes from [#41](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/41)). All tables RLS-enabled (§13). Movies only.*

### Global tables — written by service role, readable by anon + authenticated

**`movies`** — one shared row per film ever tracked, **never deleted**. *(v1, stands, plus `genres`.)*
- `id bigint identity PK`; `imdb_id text UNIQUE NULL`, `tmdb_id int UNIQUE NULL`; CHECK at least one non-NULL. **Merge rule** unchanged: when a mapping reveals an imdb-only row and a tmdb-keyed row are the same film, merge into the richer row and repoint children (an imdb-only stub has no dates/events by construction — conflict-free).
- Cached display metadata: `title`, `year`, `poster_path`, **`genres text[]`** (filled during hydration; serves table filters, the detail view, and the Stremio `genre` extra).
- Computed effective dates (post cascade): `theatrical_date`, `theatrical_region`, `digital_date`, `digital_region`.
- `refreshed_at` — the shared-cache dedupe key (one hydration per movie per window, across radar + all users).

**`release_dates`** *(v1, stands)* — raw fetched truth, overwritten each cycle: `(movie_id FK, region, medium, release_date)`, PK `(movie_id, region, medium)` — now supported-regions × media. Never notified from directly.

**`watch_providers`** *(v1, stands)* — `(movie_id FK, region, provider_id, offer_type, provider_name, logo_path, display_priority, link)`, PK `(movie_id, region, provider_id, offer_type)`. Overwritten each cycle.

**`movie_events`** (new) — the **global, append-only** event stream; replaces the *detection* half of v1's `notification_log` and remains the dedupe state (never pruned).
- `(id, movie_id FK, medium, event ∈ {announced, released, date_changed}, effective_date, seeded bool, created_at)`.
- `seeded = true` marks a past fact at first observation (v1's Seeded Event, now a global concept): counts for dedupe, is never delivered to anyone, hidden from history.
- Partial unique index on `(movie_id, medium, event) WHERE event != 'date_changed'` — announced/released at most once ever, globally per movie.

**`radar_entries`** (new) — cron-computed Digital Release Radar rows: `(region, window ∈ {recent, upcoming}, movie_id FK, rank, digital_date)`, refreshed by the radar job for all supported regions. Read by the app (anon included) and the Stremio addon.

**`refresh_runs`** — kept forever; gains **`job ∈ {full, tick, delivery, user_refresh}`** and, for `user_refresh`, **`user_id`**; plus `movies_deferred` (quota carryover, §8). SELECT is **owner-only** (not anon, not regular users); a user's own last `user_refresh` summary is exposed to them (their "last refreshed" badge).

### Per-user tables — RLS `user_id = auth.uid()`

**`profiles`** (new) — `user_id PK`, `role ∈ ('owner','user')`; created by trigger on signup (which also creates the Followed list). Readable by its user, written only by service role.

**`settings`** — singleton → per-user row (`user_id PK`): `region_cascade text[]` (ordered subset of the supported set), `notify_hour int` (default 9), **`timezone text`** (IANA, defaulted from the browser at signup), `notifications_paused bool`, `notify_email` (only *honored* for the owner).

**`lists`** — gains `user_id`; `kind ∈ ('imdb_watchlist','manual')`; keeps `name`, `position`, `sync_enabled`, `notifications_enabled`, `config` (`{"imdb_user_id": "ur…"}` for watchlists; manual lists need none).

**`list_memberships`** *(v1 semantics stand)* — soft membership, never deleted: `(list_id FK, movie_id FK, on_list bool, added_at, removed_at)`, PK `(list_id, movie_id)`. A movie is **active** iff `on_list = true` somewhere; only active movies are refreshed via user sync (radar movies refresh via the radar job). RLS through the list's `user_id` (denormalizing `user_id` onto the row is an execution-time optimization).

**`push_subscriptions`** — gains `user_id`: `(id, user_id, endpoint UNIQUE, p256dh, auth, created_at)`. UI inserts/deletes; pipeline deletes on 404/410.

**`notification_deliveries`** (new) — replaces the *delivery* half of `notification_log`: `(user_id, event_id FK, channel, sent_at)`. History feed = events for movies you follow, with your delivery status alongside.

**Derived statuses** (UI language, never stored) *(v1, stands)*: Unmatched → Waiting → Announced → In theaters → Out now.

## 8. Refresh pipeline — three jobs + Refresh-now

*Decided in [#41](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/41). The pipeline splits along the domain seam: **detection is global, delivery is per-user.***

1. **Daily full refresh** (cron): sync every sync-enabled list of every user (staggered IMDB fetches, per-list failure isolation) → resolve identities (`/find`, merge rule) → hydrate the union of all active movies **once each** → refresh `radar_entries` for all supported regions (verifying discover's dates against hydrated `release_dates`, §4) → recompute effective dates per the regions in play → detect and append `movie_events`. ~316 TMDB calls at today's scale.
2. **Hourly change tick** (cron): re-hydrate only movies `/movie/changes` reports changed (~30–50 calls); append any resulting `movie_events`.
3. **Hourly delivery** (cron): for each user whose **local** gate hour is now (per `settings.timezone`), create `notification_deliveries` for undelivered, non-seeded events on movies they follow, then send — **web push per event** for everyone; **email digest owner-only**, at the owner's gate hour. Respect per-user pause and per-list `notifications_enabled`.

**Refresh-now — per-user, scoped, rate-limited:** syncs only the caller's lists, hydrates only their movies not already fresh (shared-cache `refreshed_at` window — typically near-zero TMDB calls), ~once per 10 min per user. The **owner** keeps a full-pipeline trigger. This doubles as the new-user onboarding path: import watchlist → Refresh now → populated dashboard.

**Quota guardrails:** a per-run hydration cap (config) — when the active-movie union exceeds it, hydrate oldest-`refreshed_at`-first and carry the remainder to the next run, recording the shortfall on `refresh_runs.movies_deferred`. TMDB 429s back off and defer likewise. The radar job has its own smaller cap so user syncs can't starve the public surface (and vice versa).

## 9. Notification semantics

*v1's event model ([#6](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/6)) stands at the global layer; delivery is redefined per-user by [#41](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/41). All rules operate on **effective dates** only.*

**Detection (global, → `movie_events`):**
- Five event kinds: `theatrical_announced`, `digital_announced` (a future effective date first appears); `theatrical_released`, `digital_released` (effective date **≤ today on first observation** — not exact-match, so slipped/backfilled dates can't skip "out now"); `date_changed` (an already-announced date moves, both directions, only between announcement and release).
- Dedupe against the append-only stream, **global per movie**: announced/released at most once per (movie, medium) ever; `date_changed` fires iff the current effective date ≠ the last date logged for that (movie, medium). Same-run precedence: a date first appearing already in the past fires only `*_released`.
- **Seeding:** when a title is first observed, past facts are recorded as `seeded` events — dedupe state, never delivered, hidden from history. (One uniform rule; no special first-sync mode.)

**Delivery (per-user, → `notification_deliveries`):**
- A delivery is only created for events **created after the membership's `added_at`** — following an already-tracked movie never replays its history. This is the per-user analogue of v1's silent seeding; the global seeding rule above still covers brand-new movies.
- Gates, all required: user not paused; the movie sits on at least one of the user's `notifications_enabled` lists; the event is not seeded. Detection always runs regardless — toggling notifications on later never floods past events.
- **Channels:** push = one notification per event, tappable to the title, all users. Email = one digest per delivery batch, **owner only**. Failed push (404/410) marks the subscription for deletion, as today.

## 10. Frontend — the Console (public + signed-in)

*v1's Console (§9 of v1, built via map #28) is the base; v2 additions decided in [#42](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/42)/[#43](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/43)/[#44](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/44)/[#45](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/45)/[#46](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/46).*

- **One single-screen app, two faces.** Anonymous: the Radar view (§4, Variant A). Signed-in: the same Console with the list switcher — **Radar | Watchlist | Followed** — scoping the stat strip and table. No routes; one mental model.
- **Navbar:** wordmark · **global search** (§11) · region select (anon) · last-run badge + **Refresh now** (signed-in) · settings gear · account menu (email, **Delete account**, sign out) / **Sign in**.
- **Stat strip** (Out now / In theaters / Announced / Waiting / Unmatched) click-filters the table *(v1, stands)*.
- **Table:** poster, title+year, status badge, theatrical date, digital date (sourcing-region superscripts), provider chips for the active region. **New — sort:** clickable column headers (Title, Digital, Theatrical, Status ladder-order, Year), client-side, second click flips; default stays digital-newest-first; mobile cards get a "Sort by…" dropdown. **New — filter toolbar:** provider multi-select (from providers present in the current list × region), genre multi-select (from `movies.genres`), year range. Status filtering stays on the stat strip. Sort + filter state persists **per list/tab in localStorage** (works anonymously, no DB writes); the public radar gets the **identical controls**.
- **Movie detail — right-hand side panel** (winning prototype Variant B): drawer with poster-art header, table stays visible and clickable behind it. Content everywhere the same: overview · provider chips for the active region · cross-region date matrix (digital date + out-now/upcoming per region, from `release_dates`) · trailer slot (TMDB `videos`, fetched on demand) · **Follow/Unfollow** — for anonymous users the Follow button is the signup funnel ("Sign in to follow"). **Fully responsive:** the panel is `w-full max-w-sm`, becoming a full-screen sheet with ✕ on phones; the host table keeps its stacked-card mobile collapse. Assets: branch [`prototype-detail-view`](https://github.com/vasilyoshev/imdb-digital-release-notifier/tree/prototype-detail-view) (screenshots in `docs/prototype-detail/`).
- **Right rail, two tabs** *(v1, stands)*: **Upcoming** timeline (this is the calendar feature) + **History** (now: `movie_events` for movies you follow, with delivery status; seeded rows hidden). Anonymous: signup CTA + upcoming timeline (§4).
- **Settings modal:** global card (region cascade picker over the supported set, timezone, gate hour, pause, push-device management, notify email — owner-honored only) + one card per list (sync toggle, notifications toggle, watchlist URL config; the Followed list has no source config).
- **Onboarding:** the 2-step wizard (§3) on first sign-in.
- **PWA / push / service worker** *(v1, stands; built in #35)*: vite-plugin-pwa `injectManifest` with custom `sw.ts` (`push` + `notificationclick`); install banner; iOS 16.4+ Home-Screen requirement; subscribe from a user tap with `{ userVisibleOnly: true, applicationServerKey }`.
- **Attribution** (§16) in the footer/about **and on the public radar surface**.

## 11. Search & follow

*Decided in [#45](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/45).*

- **Navbar global search** on every view. Results dropdown: poster, title, year, digital status when already tracked, and a **Follow** button in the row.
- **`search` edge function** proxies TMDB search — the bearer token never ships to the browser; rate-limited per user.
- **Anonymous: visible but gated.** The box shows signed-out; focusing/submitting opens the signup prompt ("Sign up to search & follow any movie"). Zero anonymous TMDB spend.
- **`follow` edge function:** following an untracked movie inserts movie + membership and **hydrates it immediately** (1–2 TMDB calls — dates, poster, providers land instantly), rate-limited per user. Following an already-tracked movie is a pure membership insert. Unfollow = remove membership — from the detail panel and Followed-list rows.

## 12. Stremio addon — "Digital Release Radar"

*Decided in [#47](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/47) on the facts of [#37](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/37); full findings: [`docs/research/stremio-addon.md`](https://github.com/vasilyoshev/imdb-digital-release-notifier/blob/research/stremio-addon/docs/research/stremio-addon.md).*

- **Shape:** catalogs-only addon — pure HTTP GET + JSON: `/manifest.json` + `/catalog/movie/{id}[/{extras}].json`, CORS `Access-Control-Allow-Origin: *`, HTTPS. Response `{"metas":[…]}` of Meta Previews; page size fixed at 100, `<100` signals last page.
- **Catalogs — two,** fed from `radar_entries`: `new-digital` ("New on digital") and `upcoming-digital` ("Upcoming digital"). **Region rides in the `genre` extra dropdown** (US · BG · GB · DE, default US) — dates are the product; real genres stay in the web app. Paging via the `skip` extra. Both extras **optional**, so the catalogs appear on the Board *and* Discover.
- **Items:** raw IMDB **`tt` ids** + our poster/name/description (with the digital date) — Cinemeta renders detail pages and stream addons resolve streams for free. Radar movies **without an `imdb_id` are skipped** (they stay visible in the web app). No `meta` resource of our own.
- **Identity:** name **"Digital Release Radar"**, manifest id `uk.yoshevbot.release-notifier.radar`, description linking to release-notifier.netlify.app. The manifest URL is the addon's **permanent identity**: `https://release-notifier.netlify.app/manifest.json` (the subdomain persists even if a custom domain arrives — settled).
- **Hosting:** one hand-rolled **Netlify Function** (no SDK dependency) on the existing site, custom `path` routing, reading `radar_entries` + `movies` through the anon-readable PostgREST surface, with `Netlify-CDN-Cache-Control: public, durable, s-maxage=3600, stale-while-revalidate=86400` (optional cache-tag purge after the daily refresh).
- **Distribution — share URL first:** an "Add to Stremio" link in the web app (footer/settings). After the addon proves stable, publish via the `addonPublish` POST + stremio-addons.net (URL unchanged by publishing).

## 13. Auth & RLS matrix (v2)

*Decided in [#40](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/40). This replaces v1's role-based/no-owner-columns model and clears the blocker found in [#39](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/39): the v1 `to authenticated using (true)` UPDATE policies on lists/settings **must be replaced before signups are enabled**.*

| Role | Access |
|---|---|
| `anon` | SELECT on all global tables (`movies`, `release_dates`, `watch_providers`, `movie_events`, `radar_entries`) — needs both `GRANT SELECT … TO anon` **and** `FOR SELECT TO anon` policies |
| `authenticated` | anon's reads + full CRUD on own rows: lists (manual create/delete; all own updates), memberships of own manual lists, own settings/push_subscriptions; SELECT own profiles + deliveries |
| owner (via `profiles.role`) | + SELECT `refresh_runs`; notify email honored; full-pipeline refresh |
| `service_role` | everything (pipeline, triggers, edge functions) |

## 14. Scheduling

**Hourly pg_cron + pg_net** invocations *(mechanism v1, stands)*, now driving three jobs (§8): the delivery job runs every hour and gates **per user** on their local gate hour (`settings.timezone` — DST-safe by construction); the change tick runs every hour; the full refresh runs daily. Changing a user's send time is a row update — no cron surgery. Every run records its `job` (and `user_id` for user refreshes) in `refresh_runs`.

## 15. Backups & ops

*Decided in [#49](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/49).*

- **Nightly `pg_dump` of all three Supabase stacks on yoshevbot-1** (notifier `db-hse293…` + the two other tenants `db-xewd8i…`, `db-ssbytl…` — they hold real data and currently have zero backups) via `docker exec`, into `/var/backups/pg/`.
- **Off-site:** `rclone sync` to a free-tier object store (**Cloudflare R2 or Backblaze B2**, ~10 GB free; dumps are MBs) — off-provider disaster recovery at €0. One-time HITL step: create the bucket + credentials.
- **Retention:** 7 daily + 4 weekly, both locally and in the bucket (rclone prunes).
- **Restore drill:** one documented restore into a scratch container is part of the execution slice — a backup that's never been restored isn't a backup.

## 16. Compliance & attribution

*(v1, stands — tightened for the public surface per [#38](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/38).)*

- **TMDB:** logo + notice on every public surface **including the unauthenticated radar page itself**; use the longer terms-page wording ("…not endorsed, certified, or otherwise approved by TMDB"); unmodified logo, subordinate to app branding; don't use TMDB as a generic image host; the app must stay **revenue-free**; cached content max 6 months.
- **JustWatch:** mandatory credit wherever provider data is shown — including the radar and the Stremio addon description if provider data appears there.
- **IMDb:** unofficial GraphQL API, personal non-commercial use; query isolated in one module.

## 17. Migration from v1 (cutover sketch — detail belongs to the execution map)

1. Create `profiles` for the existing account (`role='owner'`); install the signup trigger (profile + Followed list).
2. Add `user_id` to `settings`/`lists`/`push_subscriptions`, backfill with the owner's id; drop the settings singleton constraint; add `timezone`; rename/reshape `region_order` → `region_cascade` over the supported set.
3. Split `notification_log`: distinct events → `movie_events` (v1 silent rows → `seeded=true`); each sent row → a `notification_deliveries` row for the owner (preserving `sent_at`); then drop it.
4. Delete the owner's Popular list (`tmdb_discover` rows + memberships; shared data stays); narrow the `lists.kind` CHECK.
5. New tables `radar_entries`; `movies.genres`; `refresh_runs.job`/`user_id`/`movies_deferred`; anon grants + the §13 policy set (replacing the v1 policies **before** flipping signup on).
6. Zero data loss; the owner account behaves exactly as today afterward.

## 18. Provisioning & prerequisites

The stack is live (self-hosted at `api.notifier.yoshevbot.uk`; site at `release-notifier.netlify.app`). Remaining one-time steps for the execution map:

1. **GCP consent screen → "In production"** (basic scopes only) — before enabling signup (§3).
2. **GoTrue env:** `GOTRUE_DISABLE_SIGNUP=false`, `ENABLE_EMAIL_SIGNUP=false`, rate-limit values, `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For` — only after the §13 RLS rework lands.
3. **`APP_URL` env flip** to `https://release-notifier.netlify.app` (leftover from the 2026-07-16 site rename; the old URL is dead).
4. **Backup bucket** (R2/B2) + credentials — HITL (§15).
5. **VAPID/Resend/TMDB secrets** — already provisioned in v1; unchanged.
6. No SMTP. No captcha at launch (Turnstile = config flag if needed).

## 19. Decision record (v2)

| Ticket | Decision |
|---|---|
| [#37 Stremio protocol research](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/37) | Catalogs-only HTTP addon; `tt` ids; Netlify Function + durable CDN cache; manifest URL = permanent identity |
| [#38 TMDB radar research](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/38) | `discover?with_release_type=4` is the radar engine; ~316 calls/day; compute once into shared tables; attribution on the public page |
| [#39 Open-signup research](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/39) | Google-OAuth-only, no SMTP; consent screen "In production" = no cap; GoTrue rate limits/captcha available; RLS ownership blocker found |
| [#40 Multi-tenant model + RLS](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/40) | Global movie/event/radar tables + per-user profiles/settings/lists/deliveries; curated regions; owner via `profiles.role`; migration sketch |
| [#41 Pipeline at scale](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/41) | Detection global / delivery per-user; daily full + hourly tick + hourly per-timezone delivery; per-user Refresh-now; hydration caps |
| [#42 Radar UX prototype](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/42) | Variant A "Console radar"; radar = first switcher tab after login; discover dates must be verified |
| [#43 Detail view prototype](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/43) | Variant B side panel; same content everywhere; fully responsive |
| [#44 Sort + filters](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/44) | Header-click sort; provider/genre/year filters; `movies.genres text[]`; localStorage persistence; radar parity |
| [#45 Search + follow](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/45) | `search` + `follow` edge functions; anonymous gated into signup; multi-list CRUD deferred |
| [#46 Signup & auth UX](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/46) | Google-only; 2-step wizard; self-serve delete; rate limits only, no captcha |
| [#47 Stremio addon](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/47) | "Digital Release Radar" (`uk.yoshevbot.release-notifier.radar`); two catalogs; region-in-genre; share-URL-first |
| [#48 Popular list](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/48) | Dropped — Radar replaces it; switcher = Radar \| Watchlist \| Followed |
| [#49 Backups](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/49) | Nightly pg_dump of all 3 stacks → rclone → R2/B2; 7d+4w retention; restore drill |

*v1's decision record ([#2](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/2)–[#8](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/8)) remains in force where not superseded above; see git history for the full v1 document.*
