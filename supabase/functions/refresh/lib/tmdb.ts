import type { DiscoverItem, MovieBundle, ProviderRow, RawDate } from "./types.ts";

const BASE = "https://api.themoviedb.org/3";
const REGIONS = ["BG", "US", "GB"];
const OFFER_TYPES = ["flatrate", "free", "ads", "rent", "buy"] as const;

export type DiscoverConfig = { filters?: Record<string, string | number>; limit?: number };

const ALLOWED_FILTERS = [
  "sort_by", "vote_count.gte", "vote_average.gte", "with_genres", "without_genres",
  "primary_release_date.gte", "primary_release_date.lte", "with_original_language",
  "region", "with_release_type",
  // Regional release-window filters — with `region` + `with_release_type`, these
  // bound the radar's per-region digital-release window (SPEC §4).
  "release_date.gte", "release_date.lte",
];

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, token: string, fetchFn: typeof fetch): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDb HTTP ${res.status} for ${path}`);
    return res.json();
  }
}

export async function findTmdbId(
  imdbId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  const json = await tmdbGet(`/find/${imdbId}?external_source=imdb_id`, token, fetchFn);
  return json?.movie_results?.[0]?.id ?? null;
}

export interface SearchResult {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
}

/** TMDb movie search — proxied by the `search` edge function so the bearer never
 * ships to the browser (SPEC §11). Returns up to `limit` most-relevant movies. */
export async function searchMovies(
  query: string,
  token: string,
  fetchFn: typeof fetch = fetch,
  limit = 12,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const json = await tmdbGet(
    `/search/movie?include_adult=false&query=${encodeURIComponent(q)}`,
    token,
    fetchFn,
  );
  return (json?.results ?? []).slice(0, limit).map((r: Record<string, unknown>) => ({
    tmdbId: r.id as number,
    title: (r.title as string) ?? "",
    year: r.release_date ? Number(String(r.release_date).slice(0, 4)) : null,
    posterPath: (r.poster_path as string) ?? null,
    overview: (r.overview as string) || null,
  }));
}

// deno-lint-ignore no-explicit-any
export function extractRawDates(releaseDates: any, regions: string[] = REGIONS): RawDate[] {
  const out: RawDate[] = [];
  for (const entry of releaseDates?.results ?? []) {
    if (!regions.includes(entry?.iso_3166_1)) continue;
    for (const medium of ["theatrical", "digital"] as const) {
      const type = medium === "theatrical" ? 3 : 4;
      const dates = (entry.release_dates ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((d: any) => d?.type === type && d?.release_date)
        // deno-lint-ignore no-explicit-any
        .map((d: any) => String(d.release_date).slice(0, 10))
        .sort();
      if (dates.length) out.push({ region: entry.iso_3166_1, medium, date: dates[0] });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function extractGenres(json: any): string[] {
  return (json?.genres ?? [])
    // deno-lint-ignore no-explicit-any
    .map((g: any) => g?.name)
    .filter((n: unknown): n is string => typeof n === "string" && n.length > 0);
}

/** First YouTube "Trailer" (official preferred), else any YouTube video's key. */
// deno-lint-ignore no-explicit-any
export function extractTrailerKey(json: any): string | null {
  const vids = (json?.videos?.results ?? []).filter(
    // deno-lint-ignore no-explicit-any
    (v: any) => v?.site === "YouTube" && typeof v?.key === "string",
  );
  const pick =
    // deno-lint-ignore no-explicit-any
    vids.find((v: any) => v.type === "Trailer" && v.official) ??
    // deno-lint-ignore no-explicit-any
    vids.find((v: any) => v.type === "Trailer") ??
    vids[0];
  return pick?.key ?? null;
}

// deno-lint-ignore no-explicit-any
export function extractProviders(watchProviders: any, regions: string[] = REGIONS): ProviderRow[] {
  const out: ProviderRow[] = [];
  for (const region of regions) {
    const entry = watchProviders?.results?.[region];
    if (!entry) continue;
    for (const offerType of OFFER_TYPES) {
      for (const p of entry[offerType] ?? []) {
        out.push({
          region,
          providerId: p.provider_id,
          offerType,
          providerName: p.provider_name,
          logoPath: p.logo_path ?? null,
          displayPriority: p.display_priority ?? null,
          link: entry.link ?? null,
        });
      }
    }
  }
  return out;
}

export async function fetchMovieBundle(
  tmdbId: number,
  token: string,
  fetchFn: typeof fetch = fetch,
  regions: string[] = REGIONS,
): Promise<MovieBundle | null> {
  const json = await tmdbGet(
    `/movie/${tmdbId}?append_to_response=release_dates,watch/providers,external_ids,videos`,
    token,
    fetchFn,
  );
  if (!json) return null;
  return {
    title: json.title ?? null,
    year: json.release_date ? Number(String(json.release_date).slice(0, 4)) : null,
    posterPath: json.poster_path ?? null,
    imdbId: json.external_ids?.imdb_id || null,
    overview: json.overview || null,
    genres: extractGenres(json),
    trailerKey: extractTrailerKey(json),
    rawDates: extractRawDates(json.release_dates, regions),
    providers: extractProviders(json["watch/providers"], regions),
  };
}

/** TMDb movie ids reported changed since `startDate` (YYYY-MM-DD). Paginated;
 * the hourly tick intersects this with tracked movies (SPEC §6, §8 job 2). */
export async function fetchChanges(
  startDate: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1;; page++) {
    const json = await tmdbGet(`/movie/changes?start_date=${startDate}&page=${page}`, token, fetchFn);
    for (const r of json?.results ?? []) if (typeof r?.id === "number") ids.push(r.id);
    if (!json || page >= (json.total_pages ?? 1) || page >= 500) break;
  }
  return ids;
}

export async function fetchDiscover(
  config: DiscoverConfig,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoverItem[]> {
  const limit = config.limit ?? 50;
  const params = new URLSearchParams({ include_adult: "false", include_video: "false" });
  for (const [k, v] of Object.entries(config.filters ?? {})) {
    if (ALLOWED_FILTERS.includes(k)) params.set(k, String(v));
  }
  const items: DiscoverItem[] = [];
  const pages = Math.ceil(limit / 20);
  for (let page = 1; page <= pages; page++) {
    params.set("page", String(page));
    const json = await tmdbGet(`/discover/movie?${params}`, token, fetchFn);
    for (const r of json?.results ?? []) {
      items.push({
        tmdbId: r.id,
        title: r.title,
        year: r.release_date ? Number(String(r.release_date).slice(0, 4)) : null,
        posterPath: r.poster_path ?? null,
      });
    }
    if (!json || page >= (json.total_pages ?? 1)) break;
  }
  return items.slice(0, limit);
}
