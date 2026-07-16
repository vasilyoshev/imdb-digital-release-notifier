# Stremio catalog addon — research findings

Research date: 2026-07-16. All claims verified against primary sources (official docs, source code, live manifests) unless explicitly flagged as unverified.

## TL;DR

A Stremio addon is just static-shaped HTTP GET + JSON: a `/manifest.json` plus `/catalog/{type}/{id}.json` routes, served with `Access-Control-Allow-Origin: *` over HTTPS. For a catalogs-only addon we need exactly two resources: the manifest and the `catalog` resource returning `{ "metas": [...] }` arrays of Meta Preview objects. Using raw IMDB `tt…` ids as the meta `id` is the convention that makes Cinemeta supply the full detail page and lets stream addons (Torrentio declares `idPrefixes: ["tt", "kitsu"]`) resolve streams — no `meta` handler needed on our side. Recommended host: a **Netlify Function on the existing `imdb-notifier-yoshev.netlify.app` site** with a custom `path` and `Netlify-CDN-Cache-Control` (CDN + durable caching, zero new infra); the self-hosted Supabase Edge Function is workable (`verify_jwt`/`FUNCTIONS_VERIFY_JWT` off, manual CORS) but has no CDN in front. Distribute by sharing the manifest URL / `stremio://` deep link first; optionally publish to the central catalog via a single POST to `https://api.strem.io/api/addonPublish`.

---

## 1. Addon protocol

### Manifest shape

Source: [docs/api/responses/manifest.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md) (read raw).

Required fields:

| Field | Meaning |
|---|---|
| `id` | "identifier, dot-separated, e.g. `com.stremio.filmon`" |
| `name` | human readable name |
| `description` | human readable description |
| `version` | semantic version of the addon |
| `resources` | supported resources, e.g. `["catalog", "meta", "stream", "subtitles", "addon_catalog"]` |
| `types` | supported content types (`movie`, `series`, `channel`, `tv`) |
| `catalogs` | array of Catalog objects the addon provides |

Optional fields: `idPrefixes` ("use this if you want your addon to be called only for specific content IDs"), `background` (png/jpg, ≥1024×786), `logo` (png, monochrome, 256×256), `contactEmail`, `config` (user-settable settings), `addonCatalogs`, `behaviorHints` (`adult`, `p2p`, `configurable`, `configurationRequired` — all booleans). ([manifest.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md))

Catalog object: `type` (content type), `id` ("can be any unique string describing the catalog"), `name` (human readable), `extra` (array of Extra objects). Extra object: `name` (required), `isRequired` (optional bool), `options` (optional string array), `optionsLimit` (optional number). ([manifest.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md))

### Catalog resource HTTP format

Source: [docs/protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).

- Base routes: `/manifest.json`, `/{resource}/{type}/{id}.json` — for us `/catalog/movie/{catalogId}.json`.
- Extra args: "you should define a route of the format `/{resource}/{type}/{id}/{extraArgs}.json` where `extraArgs` is the query string stringified object of extra arguments (for example `search=game%20of%20thrones&skip=100`)" — i.e. the extra props are standard URL-encoded querystring pairs embedded as a path segment before `.json`. ([protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md))
- CORS is **mandatory**: "each route, including `/manifest.json`, must serve CORS headers that allow all origins". ([protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)) The SDK README adds: "addon URLs in Stremio must be loaded with HTTPS (except `127.0.0.1`) and must support CORS!" ([README.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/README.md))
- An addon needs only "at least 1 resource and a manifest", so it can even be statically hosted. ([protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md))

### Response: `metas` array of Meta Preview objects

Source: [docs/api/requests/defineCatalogHandler.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md) and [docs/api/responses/meta.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md).

- Handler receives `{ type, id, extra: { search?, genre?, skip? }, config? }` and must resolve `{ metas: [...] }` — "an array of Meta Preview Object". ([defineCatalogHandler.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md))
- Meta Preview **required** fields: `id`, `type`, `name`, `poster` (poster is "also used as the background shown on the stremio discover page in the sidebar"). Optional: `posterShape` (`square`/`poster`/`landscape`), `genres`, `imdbRating`, `releaseInfo` (year or year range), `director`, `cast`, `links`, `description`, `trailers`. Note: `genres`/`director`/`cast` are flagged "soon be deprecated in favor of links"; the link categories `imdb`, `share`, `similar` are reserved. ([meta.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md))
- Full Meta Object (only needed if we ever served the `meta` resource — we don't) additionally supports `background`, `logo`, `released` (ISO 8601), `runtime`, `language`, `country`, `awards`, `website`, `videos`, `behaviorHints`. Poster "PNG, max 100kb"; background "max 500kb". ([meta.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md))

### Paging

"the standard page size in Stremio is 100, so the `skip` value will be a multiple of 100; if you return less than 100 items, Stremio will consider this to be the end". `skip` = "number of items skipped from the beginning". ([defineCatalogHandler.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md)) To receive `skip` at all, declare it in the catalog's `extra` (e.g. `{ "name": "skip" }`). ([docs/advanced.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md))

### Board vs Discover behavior

Source: [docs/advanced.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md). Catalogs appear on **both Board and Discover by default**. Setting `"isRequired": true` on an extra (typically `search`) makes the catalog usable only when that extra is supplied — e.g. a search-only catalog — "preventing them from appearing in standard browsing views" (Board/Discover). `"name": "genre"` with `options` produces the filter dropdown in Discover; `args.extra.genre` carries the selection. Cinemeta demonstrates this live: its `movie/year` catalog declares genre as **required**, so it appears as a Discover filter view rather than a Board row ([v3-cinemeta.strem.io/manifest.json](https://v3-cinemeta.strem.io/manifest.json)). Practical rule for us: declare only optional extras (`skip`, optionally `genre`) so both catalogs get Board rows.

### Cache fields — clarification

`cacheMaxAge`, `staleRevalidate`, `staleError` are **handler-response fields in the SDK, not manifest fields** (confirming the ticket's suspicion): each "sets the `Cache-Control` header" to `max-age=…`, `stale-while-revalidate=…`, `stale-if-error=…` respectively. ([defineCatalogHandler.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md)) If we hand-roll the HTTP layer (no SDK), we simply set the equivalent `Cache-Control` header ourselves.

---

## 2. ID conventions: `tt…` vs `tmdb:`

- **`idPrefixes` routing**: manifest.md — "use this if you want your addon to be called only for specific content IDs". Stremio dispatches `meta`/`stream` requests to every installed addon whose declared prefixes match the item id. ([manifest.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md))
- **Cinemeta owns the `tt` prefix for metadata**: its live manifest declares `resources: ["catalog","meta","addon_catalog"]`, `types: ["movie","series"]`, `idPrefixes: ["tt"]` ([v3-cinemeta.strem.io/manifest.json](https://v3-cinemeta.strem.io/manifest.json)). So a catalog meta with `id: "tt0107290"` gets its full detail page from Cinemeta, which is pre-installed. The SDK's advanced doc confirms the convention: "Cinemeta uses IMDB IDs" (`tt0111161` for movies, `tt3107288:1:1` for series episodes) and stream addons integrate by declaring `idPrefixes: ["tt"]`. ([advanced.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md))
- **Stream resolution**: Torrentio's live manifest declares its stream resource with `"idPrefixes": ["tt", "kitsu"]` ([torrentio.strem.fun/manifest.json](https://torrentio.strem.fun/manifest.json)) — i.e. items identified by `tt` ids get Torrentio streams automatically; items with other prefixes do not.
- **`tmdb:` ids are a separate ecosystem**: the community TMDB addon declares `idPrefixes: ["tmdb:"]` and must therefore ship its own `meta` resource (`resources: ["catalog","meta"]`) because Cinemeta can't resolve `tmdb:` ids ([94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json](https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json)). Stream addons that only declare `tt`/`kitsu` (e.g. Torrentio, per its manifest above) will not be queried for `tmdb:` items. Using `tmdb:` ids therefore requires users to have the TMDB addon installed and degrades stream coverage.
- **Reference implementations use `tt`**: the official hello-world example dataset keys metas by IMDB ids (`tt0032138` etc.) with `idPrefixes: ["tt"]` ([addon-helloworld/addon.js](https://github.com/Stremio/addon-helloworld/blob/master/addon.js)); the popular catalog-only "Streaming Catalogs" addon returns metas like `{"id":"tt0107290","type":"movie","name":"Jurassic Park","poster":…}` (verified live: [catalog/movie/nfx.json](https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/catalog/movie/nfx.json)).

**Conclusion**: our `movies.imdb_id` column is exactly the right id. Rows lacking an `imdb_id` should be omitted from catalog responses (or backfilled) rather than emitted with a `tmdb:` id.

Note: for a **catalog-only** addon, `idPrefixes` has no routing effect on our own addon (we serve no `meta`/`stream`), but declaring `idPrefixes: ["tt"]` is harmless and matches prior art (Streaming Catalogs declares it too).

---

## 3. Serverless hosting fit

The addon is a handful of cache-friendly GET endpoints returning small JSON. Hard requirements from §1: HTTPS, `Access-Control-Allow-Origin: *` on every route, stable manifest URL (the transport URL *is* the addon's identity — it's what gets installed, published to central, and deep-linked; changing it orphans every installed user; see §4).

### Option A — Netlify Function on the existing site

- **Definition & routing**: modern functions are `export default async (req: Request, context: Context) => Response` plus `export const config: Config = { path: "/hello" }` — the `path` config overrides the default `/.netlify/functions/<name>` URL, so one function can own `/manifest.json` and `/catalog/*` on the existing domain ([Netlify Functions get started](https://docs.netlify.com/build/functions/get-started/)). Wildcard/parameter path routing is documented under [functions configuration → routing](https://docs.netlify.com/build/functions/configuration/).
- **CDN caching**: function responses are **not cached by default** ("Because these responses are dynamic … we don't want to risk serving stale content"); you opt in with `Cache-Control` / `CDN-Cache-Control` / `Netlify-CDN-Cache-Control` (most specific wins). Supported: `s-maxage`, `max-age`, `stale-while-revalidate`, and a Netlify-only `durable` directive that stores responses in a shared durable cache so "edge cache misses check the durable cache before invoking functions" — fewer invocations, mitigates cold starts. Example straight from the docs: `Netlify-CDN-Cache-Control: public, durable, max-age=60, stale-while-revalidate=120`. Cache tags + `purgeCache()` allow targeted invalidation (e.g. after the nightly refresh run). ([Netlify caching docs](https://docs.netlify.com/platform/caching/))
- **Limits**: streaming functions have "a 10-second execution limit and a 20 MB response size limit" ([Functions API reference](https://docs.netlify.com/build/functions/api/)). The widely-cited 10 s sync execution limit / 6 MB buffered response ceiling comes from Netlify support guides and AWS Lambda limits ([Netlify support guide](https://answers.netlify.com/t/support-guide-why-is-my-function-taking-long-or-timing-out/71689)) — *not re-verified in current primary docs*, but irrelevant either way: a 100-item catalog JSON is tens of KB and a Supabase query is well under 10 s.
- **Cold starts**: exist (Lambda-based) but Netlify publishes no numbers — *unverified specifics*; the `durable` cache + long `stale-while-revalidate` makes them a non-issue for this workload.
- **Free tier**: pricing is now credit-based — Free plan has a "300 credit limit" per month covering functions, bandwidth (20 credits/GB) and compute (10 credits/GB-hour) ([netlify.com/pricing](https://www.netlify.com/pricing/)). With CDN caching, a niche addon consumes a trivial fraction of this.

### Option B — Supabase Edge Function (self-hosted stack)

- **URL shape**: served through the Kong gateway at `/functions/v1/<function-name>` ([self-hosted functions docs](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)). Sub-routing (`/functions/v1/stremio/catalog/movie/x.json`) must be parsed inside the function.
- **Auth header**: JWT verification is **on by default** ("Keep `verify_jwt = true` (the default)…" — [functions auth docs](https://supabase.com/docs/guides/functions/auth)); on self-hosted it's controlled by `FUNCTIONS_VERIFY_JWT` in `.env` (wired to the edge-runtime's `VERIFY_JWT`), and "if verification is enabled, ensure you're passing a valid token: `Authorization: Bearer <anon_key or service_role_key>`" ([self-hosted functions docs](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)). Stremio clients send **no** Authorization header, so verification must be disabled for this function — which on self-hosted `.env`-level config is **stack-wide for the functions service**, affecting other functions too (per-function `verify_jwt = false` in `config.toml` applies to CLI/platform deploys; the self-hosted docs only document the env var — *per-function granularity on self-hosted: unverified*).
- **CORS**: manual — handle `OPTIONS` preflight and attach `Access-Control-Allow-Origin: *` headers yourself (or the `withSupabase` wrapper / `corsHeaders` import from `@supabase/supabase-js@^2/cors`) ([functions CORS docs](https://supabase.com/docs/guides/functions/cors)).
- **No CDN**: nothing in the self-hosted docs provides a CDN/edge cache in front of Kong ([self-hosted functions docs](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)); every catalog hit from every Stremio client reaches our box. `Cache-Control` headers would only help client-side caches.
- **URL stability risk**: ties the addon's public identity to the self-hosted box's domain and uptime.

**Verdict**: Netlify wins on every axis that matters here (CDN caching, CORS trivially set, stable public domain we already operate, no auth-header footguns). See Recommendation.

---

## 4. Distribution

- **Central catalog**: the SDK's `publishToCentral(addonURL)` is a single unauthenticated POST to `https://api.strem.io/api/addonPublish` with body `{"transportUrl": addonURL, "transportName": "http"}` — verified in SDK source ([src/publishToCentral.js](https://github.com/Stremio/stremio-addon-sdk/blob/master/src/publishToCentral.js)). The README: "invoke this if you want to publish your addon and it's accessible publicly on 'your-domain'"; addons can also be submitted manually via UI ([SDK README](https://github.com/Stremio/stremio-addon-sdk/blob/master/README.md)). No documented review process for catalog-only addons was found in the SDK repo (*any editorial review on Stremio's side: unverified*). Publishing requires the HTTPS manifest URL to be final — it is the identity that gets listed.
- **stremio-addons.com**: third-party, community-curated ("Built with ❤️, the Stremio Addons website is curated by the community!"); submissions were GitHub issues with a `submit-addon.yaml` template on [danamag/stremio-addons-list](https://github.com/danamag/stremio-addons-list). That repo was **archived 2025-11-06**; the site says it "is no longer maintained" and points to the successor list at stremio-addons.net / beta.stremio-addons.net ([stremio-addons.com](https://stremio-addons.com/), [Stremio-Community/stremio-addons-list](https://github.com/Stremio-Community/stremio-addons-list)).
- **Deep links**: confirmed in [docs/deep-links.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md) — "take a manifest URL like `https://watchhub-us.strem.io/manifest.json` and replace `https://` with `stremio://`", yielding `stremio://…/manifest.json`, which opens the install dialog in the app. (A web-app equivalent `https://web.stremio.com/#/addons?...` install link is commonly seen in the wild but is **not** in the SDK docs — unverified.)
- **Simplest path**: just share the manifest URL; users paste it into Stremio's addon search box. No publication needed for personal/small-audience use.

---

## 5. Prior art

- **Streaming Catalogs** ([rleroi/Stremio-Streaming-Catalogs-Addon](https://github.com/rleroi/Stremio-Streaming-Catalogs-Addon), Node/Express + Vue config UI, hosted on Stremio's free BeamUp): the closest structural template for us. Live manifest: `id: "pw.ers.netflix-catalog"`, `resources: ["catalog"]` **only**, `types: ["movie","series"]`, `idPrefixes: ["tt"]`, `behaviorHints: {"configurable": true}`, one short-id catalog per service per type (`nfx`, `hbm`, `dnp`, `amp`, `atp`) ([manifest.json](https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json)). Its catalog responses return plain IMDB ids with rich-but-optional preview fields (`imdbRating`, `genres`, `director`, `cast`) ([catalog/movie/nfx.json](https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/catalog/movie/nfx.json)). Proof that catalog-only + `tt` ids + no meta handler is a viable, popular design.
- **TMDB addon** ([mrcanelas/tmdb-addon](https://github.com/mrcanelas/tmdb-addon), TypeScript, BeamUp-hosted): `idPrefixes: ["tmdb:"]`, and consequently must serve `resources: ["catalog","meta"]`; catalogs (`tmdb.top`, `tmdb.trending`, `tmdb.year`, `tmdb.language`, `tmdb.search`) each declare `extra` for `genre` + `skip` ([live manifest](https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json)). Illustrates the cost of a non-`tt` prefix: you become responsible for metadata, and `tt`-only stream addons ignore your items.
- **Cinemeta** (official, `com.linvo.cinemeta`): catalogs demonstrate extra usage — `movie/top` with optional `search`/`genre`/`skip`, `movie/year` with **required** `genre` (Discover-only view) ([live manifest](https://v3-cinemeta.strem.io/manifest.json)).
- **Hello-world example** ([Stremio/addon-helloworld](https://github.com/Stremio/addon-helloworld)): minimal catalog handler filtering a dataset keyed by `tt` ids; metas built from id/type/name/poster only.
- Trakt/Cyberflix-style catalogs were not individually source-audited beyond the above (their pattern matches Streaming Catalogs); discovery via [github.com/topics/stremio-addon](https://github.com/topics/stremio-addon).

---

## Recommendation (for imdb-digital-release-notifier)

**Host: Netlify Function on the existing `imdb-notifier-yoshev.netlify.app` site.** One function (hand-rolled JSON, no SDK dependency needed — the SDK is convenience, not protocol) with `config.path` claiming e.g. `/stremio/manifest.json` and `/stremio/catalog/*`, querying Supabase Postgres with the service-role key server-side. Set `Access-Control-Allow-Origin: *` and `Netlify-CDN-Cache-Control: public, durable, s-maxage=3600, stale-while-revalidate=86400` on every response; optionally tag responses (`Netlify-Cache-Tag: stremio-catalogs`) and `purgeCache({tags})` at the end of the daily refresh job. Avoid the Supabase Edge Function route: no CDN, manual CORS, and disabling `FUNCTIONS_VERIFY_JWT` self-hosted is stack-wide.

**ID scheme: raw IMDB `tt` ids from `movies.imdb_id`** (skip rows without one). This delegates detail pages to Cinemeta and stream resolution to Torrentio & co. for free. Do not use `tmdb:` ids.

**Manifest sketch** (served at `https://imdb-notifier-yoshev.netlify.app/stremio/manifest.json`):

```json
{
  "id": "app.netlify.imdb-notifier-yoshev.stremio",
  "version": "1.0.0",
  "name": "Digital Release Notifier",
  "description": "Movies newly available (or coming soon) on digital / VOD, tracked from theatrical-to-digital release windows.",
  "resources": ["catalog"],
  "types": ["movie"],
  "idPrefixes": ["tt"],
  "catalogs": [
    {
      "type": "movie",
      "id": "new-digital",
      "name": "New digital releases",
      "extra": [{ "name": "skip" }]
    },
    {
      "type": "movie",
      "id": "upcoming-digital",
      "name": "Upcoming digital releases",
      "extra": [{ "name": "skip" }]
    }
  ],
  "behaviorHints": { "configurable": false, "configurationRequired": false }
}
```

(Only optional extras declared, so both catalogs appear as Board rows and in Discover. `id` is dot-separated per spec; pick any stable value — it is *not* the install identity, the URL is.)

**Example catalog response** (`GET /stremio/catalog/movie/new-digital.json`, and `/stremio/catalog/movie/new-digital/skip=100.json` for page 2 — return `digital_date DESC`, ≤100 rows; fewer than 100 signals the last page):

```json
{
  "metas": [
    {
      "id": "tt23649128",
      "type": "movie",
      "name": "Example Movie",
      "poster": "https://image.tmdb.org/t/p/w342/abc123.jpg",
      "posterShape": "poster",
      "releaseInfo": "2026",
      "description": "Digital release: 2026-07-14 (theatrical 2026-05-02)"
    }
  ],
  "cacheMaxAge": 3600
}
```

`poster` is built from our `poster_path` via TMDB's image CDN (`https://image.tmdb.org/t/p/w342{poster_path}`); `id`/`type`/`name`/`poster` are the required Meta Preview fields, the rest optional. For "Upcoming", sort `digital_date ASC` where `digital_date > now()` (or `IS NULL` with an estimate — product choice). `cacheMaxAge` only matters if we use the SDK; on Netlify the HTTP cache headers do the job.

**Distribution**: start by sharing the manifest URL + the `stremio://imdb-notifier-yoshev.netlify.app/stremio/manifest.json` deep link. Treat that URL as permanent before telling anyone (consider whether a custom domain should happen *first*, since the memory notes a custom domain is pending — changing the manifest URL later strands installs). When/if it's polished, publish with one POST to `https://api.strem.io/api/addonPublish` (`{"transportUrl": "...", "transportName": "http"}`) and submit to the stremio-addons.net community list.

---

## Sources

1. Stremio addon-sdk — manifest response docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
2. Stremio addon-sdk — meta / Meta Preview docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md
3. Stremio addon-sdk — defineCatalogHandler docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md
4. Stremio addon protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
5. Stremio addon-sdk — advanced usage (idPrefixes, Cinemeta ids, search-only catalogs): https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md
6. Stremio addon-sdk — deep links: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md
7. Stremio addon-sdk — README (HTTPS/CORS, publishToCentral, hosting): https://github.com/Stremio/stremio-addon-sdk/blob/master/README.md
8. Stremio addon-sdk — publishToCentral source: https://github.com/Stremio/stremio-addon-sdk/blob/master/src/publishToCentral.js
9. Stremio hello-world example addon: https://github.com/Stremio/addon-helloworld/blob/master/addon.js
10. Cinemeta live manifest: https://v3-cinemeta.strem.io/manifest.json
11. Torrentio live manifest: https://torrentio.strem.fun/manifest.json
12. Streaming Catalogs addon repo: https://github.com/rleroi/Stremio-Streaming-Catalogs-Addon — live manifest: https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json — live catalog: https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/catalog/movie/nfx.json
13. TMDB addon repo: https://github.com/mrcanelas/tmdb-addon — live manifest: https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json
14. Netlify Functions — get started (default export, path config): https://docs.netlify.com/build/functions/get-started/
15. Netlify Functions — configuration/routing: https://docs.netlify.com/build/functions/configuration/
16. Netlify — caching (Netlify-CDN-Cache-Control, durable, SWR, cache tags, defaults): https://docs.netlify.com/platform/caching/
17. Netlify Functions — API reference (streaming limits): https://docs.netlify.com/build/functions/api/
18. Netlify support guide — function timeouts (secondary source): https://answers.netlify.com/t/support-guide-why-is-my-function-taking-long-or-timing-out/71689
19. Netlify pricing (Free plan credits): https://www.netlify.com/pricing/
20. Supabase — securing Edge Functions (verify_jwt default): https://supabase.com/docs/guides/functions/auth
21. Supabase — Edge Functions CORS: https://supabase.com/docs/guides/functions/cors
22. Supabase — self-hosted functions (Kong, /functions/v1/, FUNCTIONS_VERIFY_JWT): https://supabase.com/docs/guides/self-hosting/self-hosted-functions
23. stremio-addons.com (community list, deprecated): https://stremio-addons.com/
24. Community addons list repo (archived 2025-11-06): https://github.com/Stremio-Community/stremio-addons-list
