// IMDb's UNOFFICIAL GraphQL API — personal, non-commercial use.
// Keep every IMDb-specific assumption inside this module (spec §3a).
import type { WatchlistItem } from "./types.ts";

const ENDPOINT = "https://api.graphql.imdb.com/";

const QUERY = `query WL($userId: ID!, $first: Int!, $after: ID) {
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
}`;

export class WatchlistPrivateError extends Error {}

export function parseImdbUserId(input: string): string | null {
  const m = input.match(/\bur\d+\b/);
  return m ? m[0] : null;
}

export async function fetchWatchlist(
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<WatchlistItem[]> {
  const items: WatchlistItem[] = [];
  let after: string | null = null;
  while (true) {
    const res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { userId, first: 250, after } }),
    });
    if (!res.ok) throw new Error(`IMDb GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors && JSON.stringify(json.errors).includes("FORBIDDEN")) {
      throw new WatchlistPrivateError("watchlist is private — set it to public on IMDb");
    }
    const conn = json.data?.predefinedList?.items;
    if (!conn) throw new Error("unexpected IMDb GraphQL response shape");
    for (const edge of conn.edges ?? []) {
      const t = edge?.node?.listItem;
      if (!t?.id || t.titleType?.id !== "movie") continue;
      items.push({ imdbId: t.id, title: t.titleText?.text ?? t.id, year: t.releaseYear?.year ?? null });
    }
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return items;
}
