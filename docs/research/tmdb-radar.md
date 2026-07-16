# Research: TMDB data for a public Digital Release Radar

Resolves [#38](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/38).
Researched 2026-07-16 against TMDb's official developer docs (developer.themoviedb.org) and
themoviedb.org terms pages. Builds on [tmdb-coverage.md](tmdb-coverage.md) (#3); established
facts from there are not re-verified.

## Verdict

**Discover is the radar engine — and it does more than expected.** `GET /3/discover/movie`
with `with_release_type=4` + `region` + `release_date.gte/lte` directly returns "movies whose
digital release in region X falls in the date range", and per the discover docs' own note the
`release_date` field in the results is the **regional, type-matched date** (not the primary
release date) when `region` is set. So enumeration does *not* need hydration just to learn the
digital date for the query region. Per-movie hydration (`/movie/{id}?append_to_response=release_dates,watch/providers`,
one call) is still needed for what the radar displays: multi-region digital dates and
JustWatch provider data. Trending and popular have **no release-type filter** — they are
ranking signals only, and discover already sorts by the same popularity metric. A full daily
refresh of a 300-title radar costs ~320 calls, trivial against the documented limit of
"somewhere in the 40 requests per second range". Public non-commercial use is fine: the API
terms do not distinguish public-facing from personal non-commercial apps — same license, same
conditions (attribution + logo, 6-month cache cap, JustWatch credit). The radar being global,
compute it once server-side on cron and serve every user from the shared table.

## 1. Discover: digital-release filtering that actually works

- `with_release_type` — verbatim parameter description: "possible values are: [1, 2, 3, 4, 5, 6]
  can be a comma (AND) or pipe (OR) separated query, can be used in conjunction with region"
  ([discover reference](https://developer.themoviedb.org/reference/discover-movie)).
  Type **4 = Digital** (enum established in [tmdb-coverage.md](tmdb-coverage.md) §2).
- The critical note block on the same reference page, verbatim: "If you specify the region
  parameter, the regional release date will be used instead of the primary release date. The
  date returned will be the first date based on your query (ie. if a with_release_type is
  specified). It's important to note the order of the release types that are used." — with the
  example that `2|3` returns the limited-theatrical date whereas `3|2` returns the theatrical
  date ([discover reference](https://developer.themoviedb.org/reference/discover-movie)).
- **Consequences:**
  - `with_release_type=4&region=US&release_date.gte=A&release_date.lte=B&sort_by=popularity.desc`
    returns exactly "movies with a US digital release in [A, B]", and each result's
    `release_date` **is that US digital date**. No hydration needed to know the digital date
    *for the query region*.
  - A pure `4` query has no type-ordering ambiguity (the `2|3` vs `3|2` caveat only bites
    pipe/comma combinations).
  - `region` takes **one** ISO-3166-1 country per query. A "globally relevant" radar therefore
    anchors on one canonical region (US — best-populated digital dates, per #3 findings) or
    runs one discover sweep per region of interest.
  - What `release_date.gte/lte` filter against when `with_release_type` is set **without**
    `region` is not documented (see Unverified flags).
- Response paging: `page` defaults to 1; results come back as `page`/`results`/`total_pages`/
  `total_results`. The fixed 20-results-per-page size is not stated on the reference page
  (see Unverified flags) but matches observed API behavior and prior work.

## 2. Trending vs popular vs discover-sort

- **`/trending/movie/{day|week}`** — "Get the trending movies on TMDB"; path param
  `time_window` = `day` (default) or `week`; the reference documents only a `language` query
  param — **no `region`, no release-type filter**
  ([trending reference](https://developer.themoviedb.org/reference/trending-movies)).
  Trending measures short-window engagement to "surface the relevant content of today (the new
  stuff)" ([popularity & trending doc](https://developer.themoviedb.org/docs/popularity-and-trending)).
- **`/movie/popular`** — "Get a list of movies ordered by popularity". Its docs state
  verbatim: "This call is really just a discover call behind the scenes", equivalent to
  discover with `sort_by=popularity.desc&include_adult=false&include_video=false&language=en-US&page=1`
  ([popular reference](https://developer.themoviedb.org/reference/movie-popular-list)).
  Supports `language`, `page`, `region`.
- **Popularity metric** (movies) blends: "Number of votes for the day", "Number of views for
  the day", daily favourites, daily watchlist adds, "Release date", "Number of total votes",
  "Previous days score" ([popularity & trending doc](https://developer.themoviedb.org/docs/popularity-and-trending)).
- **For the radar:** neither trending nor popular can express "digital". Since popular is
  literally discover-with-popularity-sort, the radar should use **discover directly** — same
  ranking, plus the release-type/date/region filters. Trending is at most a secondary
  "hot right now" badge/boost, not an enumeration source.

## 3. `/movie/upcoming` is theatrical — not the digital-upcoming source

- Docs: "Get a list of movies that are being released soon", and verbatim: "This call is
  really just a discover call behind the scenes" — equivalent to discover with
  `with_release_type=2|3&release_date.gte={min_date}&release_date.lte={max_date}&sort_by=popularity.desc&include_adult=false&include_video=false`
  ([upcoming reference](https://developer.themoviedb.org/reference/movie-upcoming-list)).
- Release types **2|3 = theatrical**, so it enumerates cinema releases. The digital-upcoming
  radar is the same discover shape with `with_release_type=4` and a future date window.

## 4. Hydration and per-refresh call budget

- One hydration call per movie: `GET /3/movie/{id}?append_to_response=release_dates,watch/providers`
  merges both sub-requests into the details response
  ([append-to-response doc](https://developer.themoviedb.org/docs/append-to-response); the
  current page shows comma-separated multi-append but no stated maximum — see Unverified
  flags; prior work cites max 20, and the radar uses only 2).
- `release_dates` returns **all countries in one call** (#3 §2) — so hydration gives the full
  multi-region digital picture even though discover was anchored to one region.
- **`/movie/changes`** as re-hydration pre-filter: "Get a list of all of the movie ids that
  have been changed in the past 24 hours"; queryable "up to 14 days at a time" via
  `start_date`/`end_date`; "100 items are returned per page"
  ([changes reference](https://developer.themoviedb.org/reference/changes-movie-list)).
  Intersect the changed-ID list with the stored candidate set and re-hydrate only the overlap.
  Caveat: the daily changed-ID list is large (many pages), so for small refresh windows it can
  cost more to page through changes than to just re-hydrate all candidates — use it for hourly
  ticks, skip it for the daily full pass.

## 5. Rate limits, caching, multi-tenant serving

- Rate limiting, verbatim: "While our legacy rate limits have been disabled for some time, we
  do still have some upper limits to help mitigate needlessly high bulk scraping. They sit
  somewhere in the **40 requests per second range**. This limit could change at any time so be
  respectful of the service we have built and respect the `429` if you receive one."
  ([rate-limiting doc](https://developer.themoviedb.org/docs/rate-limiting)). Note: the
  current wording says ~40/s, not ~50/s; legacy 40-req/10s was disabled 2019-12-16 (same page).
  No Retry-After guidance is documented — on 429, back off and retry.
- Caching: the API terms prohibit caching "for longer than 6 months, any information obtained
  through or from TMDB or the TMDB APIs" ([API terms](https://www.themoviedb.org/api-terms-of-use)).
  A radar refreshed daily/hourly is 3 orders of magnitude inside that cap.
- **Multi-tenant pattern** (radar is identical for all users):
  - One shared `radar` table (or equivalent), refreshed by a single cron job with the app's
    one API key. Users read the table; user traffic never hits TMDB.
  - Per-user watchlist syncs hydrate only that user's movies.
  - **Dedupe hydration across the whole system:** key a `movies`/hydration cache by TMDB ID
    with a `refreshed_at` timestamp; any consumer (radar cron or a user sync) skips the TMDB
    call if the row was refreshed within the current window (e.g. 24 h). A movie on the radar
    *and* on 50 watchlists is fetched once per window, not 51 times.

## 6. Terms + attribution for a PUBLIC non-commercial app

- **License scope:** free for non-commercial use with attribution; a project is commercial if
  "the primary purpose is to create revenue for the benefit of the owner"
  ([FAQ](https://developer.themoviedb.org/docs/faq)). The API terms **do not distinguish
  public-facing from personal** non-commercial applications — same license, same conditions
  ([API terms](https://www.themoviedb.org/api-terms-of-use)). Commercial use requires a
  separate written agreement.
- **Required notice** — terms wording: your application "uses TMDB and the TMDB APIs but is
  not endorsed, certified, or otherwise approved by TMDB"
  ([API terms](https://www.themoviedb.org/api-terms-of-use)); the FAQ gives the short form
  "This product uses the TMDB API but is not endorsed or certified by TMDB"
  ([FAQ](https://developer.themoviedb.org/docs/faq)). Use the terms-page (longer) wording to
  be safe.
- **Logo rules:** "every application that uses our data or images is required to properly
  attribute TMDB as the source" — approved SVG logos and brand colors at
  [logos & attribution](https://www.themoviedb.org/about/logos-attribution). The logo must be
  "less prominent than the logos or marks that primarily describe or identify Your
  Application" ([API terms](https://www.themoviedb.org/api-terms-of-use)) and may not be
  modified in color, aspect ratio, rotated, or flipped ([FAQ](https://developer.themoviedb.org/docs/faq)).
- **Other public-relevant prohibitions** ([API terms](https://www.themoviedb.org/api-terms-of-use)):
  no caching >6 months; no use of API data for ML/AI training; no using TMDB as an image
  hosting service; no selling/sublicensing access; don't conceal the app's identity.
- **JustWatch attribution**, verbatim from the watch-providers reference: "In order to use
  this data you must attribute the source of the data as **JustWatch**. If we find any usage
  not complying with these terms we will revoke access to the API." And: "This is _not_ going
  to return full deep links, but rather, it's just enough information to display what's
  available where" — link to the provided TMDB `link` URL
  ([watch-providers reference](https://developer.themoviedb.org/reference/movie-watch-providers)).
  (The standalone `docs/watch-providers` guide URL currently 404s; the reference page owns the
  requirement.)
- **Against SPEC §12** (TMDB attribution + logo + notice, 6-month cache, JustWatch
  attribution): already covers the substance. For a **public** surface, additionally ensure:
  1. The notice + logo + JustWatch credit appear on the public radar page itself (visible to
     unauthenticated visitors), not only behind login — attribution must accompany displayed
     data.
  2. Use the longer terms-page notice wording ("…not endorsed, certified, or otherwise
     approved by TMDB").
  3. Logo prominence + no-modification rules apply (unmodified approved SVG, subordinate to
     the app's own branding).
  4. Serve posters by hotlinking TMDB's CDN or short-lived cache — do not treat TMDB as the
     app's image host.
  5. Keep the app revenue-free (no ads/paywall) or the non-commercial license no longer
     applies.

## Recommended radar data strategy

**Enumeration (discover, region-anchored):**
- *Recently released digital:* `GET /3/discover/movie?with_release_type=4&region=US&release_date.gte={today−30d}&release_date.lte={today}&sort_by=popularity.desc&include_adult=false&include_video=false` — top ~150 (8 pages).
- *Upcoming digital:* same with `release_date.gte={today}&release_date.lte={today+60d}` — top ~150 (8 pages).
- Each result already carries the **US digital date** in `release_date` (discover note, §1),
  so the radar list is renderable straight from discover; popularity sort makes it
  "globally relevant" by construction.

**Hydration (1 call/movie):** `GET /3/movie/{id}?append_to_response=release_dates,watch/providers`
for each candidate — yields all-region digital dates (BG→US→GB cascade client-side, per #3)
and JustWatch providers. Store in the shared `movies` cache keyed by TMDB ID with `refreshed_at`.

**Cadence:**
- **Daily full refresh** (cron): re-run both discover sweeps, re-hydrate all candidates
  (dates shift; providers churn). ~320 calls — no changes-endpoint needed.
- **Optional hourly tick:** re-run the 16 discover pages (catches new entrants + date moves in
  the query region); re-hydrate only candidates that appear in `/movie/changes` since the last
  tick. Skip if daily freshness suffices for v1.
- Per-user watchlist syncs reuse the same hydration cache — any movie already refreshed this
  window costs zero additional TMDB calls.

**Storage:** shared radar table (movie id, title, poster, digital dates per region, providers,
popularity, section = recent|upcoming) written by the cron with the service role; all users
read it. Nothing user-specific in the radar path.

## Call-budget estimate table

Assumptions: 300 candidates (150 recent + 150 upcoming), 20 results/discover page, 1 hydration
call per movie via `append_to_response`.

| Refresh | Discover pages | Changes pages | Hydrations | Total calls | At ~40 req/s |
|---|---|---|---|---|---|
| Daily full (300 candidates) | 16 | 0 | 300 | **~316** | < 10 s |
| Hourly incremental | 16 | ~3 | ~10–30 (changed ∩ candidates) | **~30–50** | ~1 s |
| Daily full + 200-title user watchlist (dedup'd) | 16 | 0 | 300 + ≤200 | **~516 worst case** | < 15 s |
| Monthly ceiling (daily full only) | — | — | — | ~9.5 k | negligible |

Even the worst case is a rounding error against "somewhere in the 40 requests per second
range"; throttle the cron to a few req/s anyway and honor any 429.

## Unverified flags

- **20 results per page / 500-page cap:** not stated on the discover, popular, or trending
  reference pages fetched, and the FAQ has no pagination entry. 20/page matches prior work and
  observed API behavior; treat the exact numbers as empirical, not documented.
- **`append_to_response` max 20 appends:** the current
  [append-to-response doc](https://developer.themoviedb.org/docs/append-to-response) shows
  multi-append but states no maximum. The "20" figure comes from prior research / legacy docs.
  Irrelevant in practice here (radar appends 2).
- **`release_date.gte/lte` semantics without `region`:** the discover note only defines
  behavior when `region` is specified. Whether the filter matches any-region dates of the
  given type when `region` is omitted is undocumented — always pass `region`.
- **Trending `page`/`region` params:** the trending reference visibly documents only
  `language` (+ `time_window` path param); the response is paginated (`page`/`total_pages`),
  but a `page` query param wasn't visible in the fetched content. Moot — trending isn't the
  enumeration source.
- **`docs/watch-providers` guide page returns 404** as of 2026-07-16; the JustWatch
  requirement is quoted from the [reference page](https://developer.themoviedb.org/reference/movie-watch-providers),
  which is authoritative.
