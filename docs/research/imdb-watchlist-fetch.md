# Fetching a public IMDb watchlist without a headless browser

Research for issue #2. All findings below were verified empirically on 2026-07-15 by issuing
real requests against IMDb (Node 24 `fetch`/undici, curl, and a real Chrome via Playwright for
control experiments). Response excerpts are copied verbatim from observed responses.

## TL;DR

**Recommended:** one unauthenticated POST per page to IMDb's public GraphQL endpoint
`https://api.graphql.imdb.com/` (or the CDN-cached `https://caching.graphql.imdb.com/`), using
`predefinedList(classType: WATCH_LIST, userId: "ur…")` with cursor pagination (`first: 250`,
`after: <endCursor>`). A 216-item watchlist came back in a single ~40 KB response in under 1 s.
No cookies, no API key, no browser.

**Fallback:** plain GET of the watchlist HTML page and parsing the embedded `__NEXT_DATA__`
JSON — works but sits behind AWS WAF, which can serve a JavaScript challenge that a plain
`fetch` cannot solve.

**Dead end:** the old `/list/lsXXXX/export` CSV endpoint returns **404** (verified in a real
browser) — the CSV export now only exists as an authenticated async "export queue" feature.

---

## 1. The GraphQL API (recommended)

### Endpoint behaviour

`POST https://api.graphql.imdb.com/` with `Content-Type: application/json` and any
`User-Agent` answers **200** to anonymous queries. Critically, it did so from a client whose
requests to `www.imdb.com` were simultaneously being blocked by AWS WAF (see §3) — the GraphQL
host is not behind the same challenge action.

`https://caching.graphql.imdb.com/` accepts the same POST and was faster in our test
(527 ms vs 876 ms for the identical query); it is a CDN-cached variant the IMDb site itself
uses for read-only queries.

Introspection is blocked (`"Unauthorized introspection request. Token is invalid or missing"`),
but normal queries validate and execute.

### The watchlist query

The exact query verified to work end-to-end (against `ur27472448`, a public watchlist used as
the demo account of an open-source Stremio addon):

```graphql
query WL($userId: ID!, $first: Int!, $after: ID) {
  predefinedList(classType: WATCH_LIST, userId: $userId) {
    id                        # the backing list ID, e.g. "ls005354968"
    items(first: $first, after: $after) {
      total
      edges {
        node {
          listItem {
            ... on Title {
              id                       # "tt2654620"
              titleText { text }       # "The Strain"
              originalTitleText { text }
              releaseYear { year }     # 2014
              releaseDate { day month year }
              titleType { id }         # "movie" | "tvSeries" | "tvMiniSeries" | ...
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

Observed response (truncated):

```json
{"data":{"predefinedList":{"id":"ls005354968","items":{"total":216,
 "edges":[{"node":{"listItem":{"id":"tt2654620","titleText":{"text":"The Strain"},
 "releaseYear":{"year":2014},"titleType":{"id":"tvSeries"}}}}, ...],
 "pageInfo":{"hasNextPage":true,"endCursor":"eyJzb3J0Ijp7ImJ5IjoiTElTVF9PUkRFUiIs..."}}}},
 "extensions":{"disclaimer":"Public, commercial, and/or non-private use of the IMDb data
 provided by this API is not allowed. For limited non-commercial use ... see
 https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/..."}}
```

Notes:

- `$after` is typed `ID`, not `String` (a `String` variable is rejected with
  `Variable "$after" of type "String" used in position expecting type "ID"`).
- The watchlist's backing `ls…` ID (returned as `predefinedList.id`) can also be queried
  directly via `Query.list(id: "ls…")` — verified to return the identical 216 items. Any
  ordinary public list is fetchable the same way.
- Rich per-title fields are available on `Title` (`releaseDate`, `ratingsSummary`, `plot`,
  `titleGenres`, `primaryImage`, …) if the notifier wants more than IDs.

### Privacy semantics (observed)

- Public watchlist → full data.
- Private watchlist → `{"errors":[{"message":"FORBIDDEN exception code while fetching data
  (/predefinedList) : Permission denied", "extensions":{"code":"FORBIDDEN"}}], "data":{"predefinedList":null}}`
  (observed for `ur125655832`). Detect this and tell the user to set their watchlist to public.
- Nonexistent/empty user → `{"data":{"predefinedList":null}}` with no error.

### Pagination beyond 250

- `items(first: 250)` is accepted; the connection returned all 216 items of the test list in
  one page. `first: 300` was also accepted (could not observe the hard cap with a 216-item
  list; community scrapers uniformly use 250 as the page size, matching the IMDb web UI).
- Cursor pagination verified: fetching the same list in pages of 100 took 3 requests and
  yielded 216 unique IDs with no duplicates or gaps (`pageInfo.hasNextPage` /
  `endCursor` → `after`). The cursor is a base64 JSON offset token, e.g.
  `{"sort":{"by":"LIST_ORDER","order":"ASC"},"offset":1,...}`.
- So a 200+ (or 1000+) title watchlist is a simple loop: `first: 250`, follow `endCursor`
  until `hasNextPage` is false. `total` is returned on every page for progress/validation.

### Corroboration

Multiple independent open-source projects use exactly this query in production server
environments (no browser): `yayoscar/stremio-imdb-watchlist` (PAGE_SIZE 250, via
`caching.graphql.imdb.com`), `leo-mathurin/stremlist`, `Hoffs/imdb-calendar`,
`josh/imdb-data`, `1150854/anilist_stremio_addon`. Some send `x-imdb-client-name:
imdb-web-next` / `imdb-next-desktop`; our tests worked without it.

## 2. CSV export endpoint: dead

`https://www.imdb.com/list/ls005354968/export` (with and without trailing slash) returns
**HTTP 404**, verified in a real Chrome session that was otherwise passing the WAF and could
view the list. IMDb's current export feature is an asynchronous, login-required "export queue"
(you click Export, wait, then download from your exports page). There is no unauthenticated
CSV for public watchlists anymore.

## 3. HTML page + `__NEXT_DATA__` (fallback) and the AWS WAF problem

### What the page embeds

In a real browser, `https://www.imdb.com/user/ur27472448/watchlist/` contains a
`<script id="__NEXT_DATA__" type="application/json">` whose payload holds the full first page
of the list at:

```
props.pageProps.mainColumnData.predefinedList.titleListItemSearch
  .total          # 216
  .edges[]        # all 216 items were embedded (hasNextPage: false)
  .edges[].listItem.{id, titleText.text, releaseYear.year, titleType.id, releaseDate, ...}
props.pageProps.totalItems / totalPossibleItems
props.pageProps.mainColumnData.predefinedList.{id, author, visibility, lastModifiedDate}
```

So parsing `__NEXT_DATA__` from one GET is viable for lists up to the page size (the web UI
paginates at 250 via `?page=2`, which serves a fresh `__NEXT_DATA__` per page).

### Why it is only the fallback

`www.imdb.com` sits behind **AWS WAF with a JavaScript challenge**. During testing, every
plain-HTTP client on this machine (curl, Node `fetch`, PowerShell) received
`HTTP 202` with a ~2 KB challenge page instead of content:

```html
<script src="https://…token.awswaf.com/…/challenge.js"></script>
… "In order to continue, we need to verify that you're not a robot.
   This requires JavaScript. Enable JavaScript and then reload the page."
```

The challenge issues an `aws-waf-token` cookie via JS that a plain fetch cannot obtain. The
WAF action is conditional (many scrapers report plain fetches of IMDb HTML working most of the
time), but once an IP/fingerprint is flagged — a real risk for shared datacenter egress IPs
like Supabase's — the HTML route fails hard while the GraphQL route keeps working (observed
directly: same machine, same minute, HTML blocked, GraphQL 200).

If used, send browser-like headers: full Chrome `User-Agent`, `Accept:
text/html,application/xhtml+xml,…`, `Accept-Language: en-US,en;q=0.9` — and treat
`202` + `awswaf` in the body as "blocked, try GraphQL".

## 4. Rate limits / bot detection for one fetch per day

- One or a few GraphQL POSTs per day is far below any observable threshold; the endpoint
  serves the IMDb SPA itself and community addons poll it continuously from datacenter hosts.
- Send: `Content-Type: application/json`, a realistic `User-Agent`, optionally
  `x-imdb-client-name: imdb-web-next`. Nothing else needed; no cookies.
- Back off on non-200 (the API returns structured GraphQL errors with `isRetryable` flags).
- Legal caveat: every response carries a disclaimer that public/commercial use of the data is
  not allowed and points to IMDb's conditions for limited non-commercial use
  (help.imdb.com article G5JTRESSHJBBHTGX). A personal single-user notifier is squarely
  "personal, non-commercial", but this is an unofficial API that IMDb may change or gate at
  any time — keep the query in one module so it is cheap to adapt.

## 5. Fit for Supabase Edge Functions

Current documented limits (supabase.com/docs/guides/functions/limits): **256 MB memory**,
**2 s CPU time per request**, wall clock **150 s** (free) / **400 s** (paid), request idle
timeout 150 s, 20 MB bundle.

Measured cost of the whole job: one POST returning **40,129 bytes** in **527–876 ms** for
216 items with the full field set above. Even a 1,000-title watchlist is ~4 sequential
requests and <200 KB of JSON — network-bound, milliseconds of actual CPU. Comfortably inside
Edge Function limits with two orders of magnitude of headroom. `fetch` is native in Deno; no
dependencies are required (no cheerio, no HTML parsing on the recommended path).

## 6. Accepted URL forms → `ur` ID

The only input the GraphQL query needs is the `ur…` user ID:

| User pastes                                        | Extraction                                   |
|----------------------------------------------------|----------------------------------------------|
| `https://www.imdb.com/user/ur27472448/`            | regex `/ur\d+/` → `ur27472448`               |
| `https://www.imdb.com/user/ur27472448/watchlist`   | same regex                                   |
| bare `ur27472448`                                  | already the ID (validate `^ur\d+$`)          |
| `https://www.imdb.com/list/ls005354968/…`          | use `Query.list(id: "ls…")` directly         |
| `https://www.imdb.com/user/p.ulgvo2i7…/watchlist/` | **not resolvable without fetching HTML** — see below |

Recommended parse: `const m = input.match(/ur\d{6,}/) ?? input.match(/ls\d{6,}/)`; use
`predefinedList` for `ur`, `list(id:)` for `ls`.

Caveat: IMDb now redirects logged-in users' own profile URLs to an opaque slug form
(`/user/p.xxxxxxxx/watchlist/`, observed in-browser). That slug is not accepted by the GraphQL
API and can only be mapped back to a `ur` ID by fetching the HTML (WAF risk). The UI should
ask for the classic `ur…` URL/ID (visible on the user's profile page address bar when logged
out, or under "Your activity") and reject `p.…` slugs with a helpful message.

## Recommended implementation sketch (Deno / Supabase Edge Function)

```ts
const GQL = "https://api.graphql.imdb.com/"; // or caching.graphql.imdb.com
async function fetchWatchlist(userId: string) {
  const ids: { id: string; title: string; year?: number; type: string }[] = [];
  let after: string | null = null;
  do {
    const res = await fetch(GQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ query: WL_QUERY, variables: { userId, first: 250, after } }),
    });
    const { data, errors } = await res.json();
    if (errors?.some((e: any) => e.extensions?.code === "FORBIDDEN"))
      throw new Error("Watchlist is private — set it to public on IMDb.");
    const conn = data?.predefinedList?.items;
    if (!conn) throw new Error("No watchlist found for " + userId);
    for (const { node } of conn.edges) {
      const t = node.listItem;
      ids.push({ id: t.id, title: t.titleText.text, year: t.releaseYear?.year, type: t.titleType.id });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return ids;
}
```

## Risks

1. **Unofficial API** — no versioning contract; IMDb could add auth or persisted-query
   enforcement. Mitigation: isolate in one module; the `__NEXT_DATA__` fallback shares the
   same response shape (`titleListItemSearch` vs `items`), so a parser swap is small.
2. **WAF expansion** — if AWS WAF is ever put in front of `api.graphql.imdb.com` with a JS
   challenge, no plain-fetch method survives; the escape hatch would be user-supplied CSV
   export upload (the authenticated export queue) or a residential proxy.
3. **ToS** — data is for personal non-commercial use only (disclaimer in every response).
4. **Privacy toggles** — user must keep the watchlist public; surface the FORBIDDEN error as
   an actionable message.

## Sources / evidence trail

- Live responses from `api.graphql.imdb.com` and `caching.graphql.imdb.com` (2026-07-15).
- Live `__NEXT_DATA__` of `imdb.com/user/ur27472448/watchlist/` via real Chrome (2026-07-15).
- Live 404 of `imdb.com/list/ls005354968/export` via real Chrome (2026-07-15).
- AWS WAF challenge page served to curl/Node/PowerShell on `www.imdb.com` (2026-07-15).
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- IMDb data-use policy: https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX
- Corroborating community implementations: github.com/yayoscar/stremio-imdb-watchlist,
  github.com/leo-mathurin/stremlist, github.com/Hoffs/imdb-calendar, github.com/josh/imdb-data.
