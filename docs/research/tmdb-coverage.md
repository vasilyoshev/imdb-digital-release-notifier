# Research: Does TMDb alone cover all data needs?

Resolves [#3](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/3).
Researched 2026-07-15 against TMDb's official developer docs (developer.themoviedb.org).

## Verdict

**Yes — TMDb alone is sufficient. Drop MDBList.**

Every feature the notifier needs is covered: IMDb→TMDb mapping, theatrical + digital
release dates with all regions returned in a single call (so the BG → US → GB fallback
is pure client-side logic), Bulgaria streaming availability via JustWatch-powered data,
and posters/metadata for the dashboard. A daily 200-title refresh costs ~200 API calls,
which is negligible against TMDb's rate limits, and free non-commercial use is explicitly
permitted. The only genuine caveat is data *quality*, not API capability: TMDb is
community-edited, so a Bulgarian digital date may simply not exist for a given title —
which the US/GB fallback already mitigates.

## 1. IMDb → TMDb mapping: `/find/{external_id}`

- `GET /3/find/{external_id}?external_source=imdb_id` searches all object types and
  returns results split into `movie_results`, `tv_results`, `person_results`, etc.
  ([docs](https://developer.themoviedb.org/reference/find-by-id))
- **No batch form exists** — one `external_id` per call. Mapping ~200 titles costs
  200 calls, but this is a **one-time** cost: cache the TMDb IDs (e.g. in Supabase)
  and never re-map.
- Caveats: read `movie_results` specifically (a `tt` ID can resolve to a TV entry),
  and handle the empty-result case (title not yet on TMDb). IMDb IDs are unique per
  TMDb object, so expect 0 or 1 movie result.

## 2. Release dates: `/movie/{movie_id}/release_dates`

- Release type enum, per the [reference page](https://developer.themoviedb.org/reference/movie-release-dates):
  **1** Premiere, **2** Theatrical (limited), **3** Theatrical, **4** Digital,
  **5** Physical, **6** TV. Type 3 = wide theatrical; type 4 = digital (VOD/EST/streaming).
- Response is a `results` array keyed by `iso_3166_1` country code, each entry holding
  `release_dates` (`certification`, `release_date`, `type`, `note`). **All countries
  come back in one call** — the BG → US → GB preference cascade costs zero extra requests.
- Reliability: no completeness guarantee anywhere in the docs. TMDb is explicitly
  "a community built movie and TV database" ([about](https://www.themoviedb.org/about)).
  No official statement on per-region coverage exists; in practice US type-4 dates are
  the best populated, BG dates are sparse, and digital dates can appear late or shift —
  the daily refresh should treat dates as mutable until they pass.

## 3. Watch providers: `/movie/{movie_id}/watch/providers`

- "Powered by our partnership with JustWatch" — `results` keyed by country code, each
  with `link` plus `flatrate`, `rent`, `buy`, `ads`, `free` arrays.
  ([docs](https://developer.themoviedb.org/reference/movie-watch-providers))
- **Attribution is mandatory**, verbatim: "In order to use this data you must attribute
  the source of the data as JustWatch. If we find any usage not complying with these
  terms we will revoke access." The API deliberately returns no provider deep links —
  link to the provided `link` URL instead. The dashboard must show a JustWatch credit.
- **Bulgaria is supported**: TMDb's own site renders BG watch data (e.g. Apple TV Store
  rent/buy for [Dune: Part Two, locale=BG](https://www.themoviedb.org/movie/693134-dune-part-two/watch?locale=BG)),
  and JustWatch runs a dedicated [BG site](https://www.justwatch.com/bg) with 30+
  providers (Netflix, Prime Video, Apple TV, Disney+, HBO Max, …). Confirm at runtime
  with one call to [`/watch/providers/regions`](https://developer.themoviedb.org/reference/watch-providers-available-regions).

## 4. Rate limits, terms, auth

- [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting): the original
  40 req/10s limit was disabled in Dec 2019; current limits "sit somewhere in the
  **40 requests per second** range" — respect `429`s. (The ~50/s figure seen in blog
  posts does not match current doc wording.)
- [FAQ](https://developer.themoviedb.org/docs/faq): "Our API is free to use for
  non-commercial purposes as long as you attribute TMDB as the source of the data
  and/or images." A personal notifier is squarely non-commercial.
- [API Terms of Use](https://www.themoviedb.org/api-terms-of-use): display the TMDB
  logo + the "uses TMDB … but is not endorsed" notice; cached TMDB content must not be
  kept longer than **six months** (a daily refresh keeps stored dates/posters well inside this).
- [Auth](https://developer.themoviedb.org/docs/authentication-application): v3 `api_key`
  query param or (recommended default) the API Read Access Token as
  `Authorization: Bearer …`, which works across v3 and v4 with identical access —
  the cleaner fit for a Deno `fetch` in a Supabase Edge Function.

## 5. Metadata, posters, images

- [`/movie/{movie_id}`](https://developer.themoviedb.org/reference/movie-details)
  returns title, overview, `poster_path`, `release_date`, `imdb_id`, runtime, genres, status, etc.
- [`append_to_response`](https://developer.themoviedb.org/docs/append-to-response):
  comma-separated sub-endpoints within the same namespace, 20 items max. So
  `GET /3/movie/{id}?append_to_response=release_dates,watch/providers` fetches
  details + dates + BG providers in **one** request.
- [Images](https://developer.themoviedb.org/docs/image-basics): URL =
  `base_url + size + file_path`, e.g.
  `https://image.tmdb.org/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg`.
  Fetch [`/configuration`](https://developer.themoviedb.org/reference/configuration-details)
  once for `secure_base_url` and valid `poster_sizes` (typically w92…w780, original).

## 6. Daily call budget (200 titles)

| Approach | Calls/day |
|---|---|
| Separate details + release_dates + watch/providers | 600 |
| **details with `append_to_response=release_dates,watch/providers`** | **200** |
| Plus [`/movie/changes`](https://developer.themoviedb.org/reference/changes-movie-list) pre-filter (re-fetch only changed IDs) | typically far below 200 |

One-time setup: ~200 `/find` calls + 1 `/configuration` call. At the documented
~40 req/s range, 200 calls is ~5 s of budget; even self-throttled to 5 req/s the run
finishes in ~40 s — trivially inside a daily Supabase Edge Function cron.

## 7. What TMDb cannot do (and why it doesn't reopen the MDBList decision)

- **No batch data endpoints.** [Daily ID exports](https://developer.themoviedb.org/docs/daily-id-exports)
  contain only IDs/popularity (no dates); [`/movie/changes`](https://developer.themoviedb.org/reference/changes-movie-list)
  lists IDs changed in the last 24h (up to 14 days back) — useful as an optimization,
  not a data source.
- **No webhooks/push feeds** — polling only, which a daily cron is anyway.
- MDBList does offer a batch media-info endpoint with a `released_digital` field, but
  it is itself an aggregator (not more authoritative), its exact batch size and free-tier
  quota could not be verified from primary sources (docs blocked/JS-rendered), and at
  200 titles/day the batching advantage is worthless. **Decision stands: TMDb only.**

## Unverified flags

- Exact `poster_sizes` array and BG's literal presence in the `/watch/providers/regions`
  response body (doc pages truncated during research) — each confirmable with one live call.
- Per-region completeness of digital dates — no official statement exists; mitigated by design (US/GB fallback).
- Whether `release_dates` appears as a named change key in `/movie/{id}/changes` —
  community-confirmed only; verify with a live call before relying on the changes pre-filter.
