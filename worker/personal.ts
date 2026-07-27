/**
 * Personalized (token'd) Stremio addon surface (map #109, tickets #112 + #116).
 * Pure logic: a 48-hex addon token resolves to a server-side config via two
 * anon-key RPCs (migration 20260726090000) — stremio_config_by_token for the
 * manifest, stremio_list_movies for one list's rows.
 *
 * Config contract v2 (#116): `config.catalogs` is an ORDERED ARRAY of
 * user-defined catalogs, each its own source + filter combination — two
 * catalogs may share a source with different filters. A missing/invalid array
 * resolves to the default set (one per list + both radar windows). Sorting,
 * filtering, and the status ladder reuse the Console's pure table logic
 * (src/lib) so the addon and the web table can never disagree.
 */
import { applyControls, type SortDir, type SortKey } from "../src/lib/table-controls";
import {
  type DerivedStatus,
  effectiveVotes,
  type Movie,
  STATUS_ORDER,
  statusOf,
  todayISO,
} from "../src/lib/dashboard";
import {
  anonManifestBase,
  APP_URL,
  CATALOGS,
  type Meta,
  PAGE_SIZE,
  REGIONS,
} from "./stremio-core";

/** Addon tokens are 48 hex chars (24 random bytes) — hex can never contain
 * "manifest.json", which Stremio's Configure button replaces in the URL. */
export const TOKEN_RE = /^[0-9a-f]{48}$/;

/** Distinct from the anon addon's id so both can be installed side by side;
 * stable across token regenerations (Stremio keys installs on the URL). */
export const PERSONAL_ADDON_ID = "uk.yoshevbot.release-notifier.personal";

export interface TokenList {
  id: number;
  name: string;
  kind: string;
}

/** stremio_config_by_token's row (null when the token is unknown/revoked). */
export interface TokenData {
  config: { catalogs?: unknown };
  lists: TokenList[];
}

/** stremio_list_movies' row. */
export interface ListRow {
  imdb_id: string | null;
  tmdb_id: number | null;
  title: string | null;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  digital_date: string | null;
  theatrical_date: string | null;
  imdb_rating: number | null;
  imdb_votes: number | null;
  tmdb_rating: number | null;
  tmdb_votes: number | null;
  popularity: number | null;
  added_at: string | null;
}

/** A catalog source: one of the user's lists, or a radar window (the radar
 * sources reuse the anon addon's catalog ids). */
export type CatalogSource = string; // "list-<id>" | "new-digital" | "upcoming-digital"

/** Radar rows arrive pre-ranked by the pipeline's own curation, which is the
 * whole point of the radar — so radar catalogs get an extra sort key meaning
 * "leave the curated order alone". It is deliberately not part of the Console's
 * SortKey: no table column ranks rows this way. */
export type CatalogSortKey = SortKey | "rank";

/** One user-defined catalog, fully resolved (defaults filled in). */
export interface CatalogDef {
  id: string;
  name: string;
  source: CatalogSource;
  enabled: boolean;
  sort: { key: CatalogSortKey; dir: SortDir };
  minVotes: number | null;
  status: DerivedStatus | null;
  region: string;
}

const SORT_KEYS: SortKey[] = [
  "title",
  "digital",
  "theatrical",
  "status",
  "year",
  "rating",
  "popularity",
  "added",
];

export function isRadarSource(source: string): boolean {
  return CATALOGS.some((c) => c.id === source);
}

export function listIdOfSource(source: string): number | null {
  const m = /^list-(\d+)$/.exec(source);
  return m ? Number(m[1]) : null;
}

/** Sanitize one stored catalog entry; null if it can't identify itself or
 * points at a source the user doesn't have (e.g. a deleted list). */
function sanitizeDef(raw: unknown, lists: TokenList[]): CatalogDef | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const source = typeof r.source === "string" ? r.source : "";
  const listId = listIdOfSource(source);
  const list = listId != null ? lists.find((l) => l.id === listId) : undefined;
  if (!list && !isRadarSource(source)) return null;
  const sort = (r.sort ?? {}) as Record<string, unknown>;
  const fallbackName = list?.name ?? CATALOGS.find((c) => c.id === source)?.name ?? source;
  // Radar catalogs may keep the curated rank (and default to it); list catalogs
  // have no rank to keep, so they default to newest-digital-first.
  const radar = isRadarSource(source);
  const allowedKeys: CatalogSortKey[] = radar ? ["rank", ...SORT_KEYS] : SORT_KEYS;
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : fallbackName,
    source,
    enabled: r.enabled !== false,
    sort: {
      key: allowedKeys.includes(sort.key as CatalogSortKey)
        ? (sort.key as CatalogSortKey)
        : radar
          ? "rank"
          : "digital",
      dir: sort.dir === "asc" ? "asc" : "desc",
    },
    minVotes: typeof r.minVotes === "number" && r.minVotes > 0 ? r.minVotes : null,
    status: STATUS_ORDER.includes(r.status as DerivedStatus)
      ? (r.status as DerivedStatus)
      : null,
    region: typeof r.region === "string" && /^[A-Z]{2}$/.test(r.region) ? r.region : "US",
  };
}

/** The starter set a fresh (or legacy/invalid) config resolves to: one catalog
 * per list + both radar windows. Ids equal sources so they stay stable. */
export function defaultCatalogs(lists: TokenList[]): CatalogDef[] {
  const defs: CatalogDef[] = lists.map((l) => ({
    id: `list-${l.id}`,
    name: l.name,
    source: `list-${l.id}`,
    enabled: true,
    sort: { key: "digital", dir: "desc" },
    minVotes: null,
    status: null,
    region: "US",
  }));
  for (const c of CATALOGS) {
    defs.push({
      id: c.id,
      name: c.name,
      source: c.id,
      enabled: true,
      sort: { key: "rank", dir: "desc" },
      minVotes: null,
      status: null,
      region: "US",
    });
  }
  return defs;
}

// ---- Anonymous configs carried in the URL (#118) ---------------------------
//
// A visitor with no account configures radar catalogs and installs; the config
// travels base64url-encoded in the path instead of a DB row, so there is no
// token to leak and nothing to revoke. base64url has no ".", so an encoded
// config can never contain "manifest.json" — the #110 constraint holds.

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Only the fields that differ from the resolved defaults go into the URL, so
 * a typical config stays well under a hundred characters. */
export function encodeCatalogs(defs: CatalogDef[]): string {
  const slim = defs.map((d) => {
    const base = defaultCatalogs([]).find((b) => b.source === d.source);
    const out: Record<string, unknown> = { id: d.id, source: d.source };
    if (d.name !== (base?.name ?? d.source)) out.name = d.name;
    if (!d.enabled) out.enabled = false;
    if (d.sort.key !== (base?.sort.key ?? "digital")) out.sort = d.sort;
    else if (d.sort.dir !== "desc") out.sort = d.sort;
    if (d.minVotes != null) out.minVotes = d.minVotes;
    if (d.status != null) out.status = d.status;
    if (d.region !== "US") out.region = d.region;
    return out;
  });
  return b64urlEncode(JSON.stringify(slim));
}

/** Decode an anonymous config. Resolved against an empty list set, so any
 * list-backed source is dropped — private lists are never URL-addressable.
 * Anything unparseable falls back to the plain radar pair rather than erroring,
 * so a mangled link still installs something sensible. */
export function decodeCatalogs(encoded: string): CatalogDef[] {
  try {
    const parsed = JSON.parse(b64urlDecode(encoded));
    if (!Array.isArray(parsed)) return defaultCatalogs([]);
    return parseCatalogs({ catalogs: parsed }, []);
  } catch {
    return defaultCatalogs([]);
  }
}

/** The user's catalogs, in order — the stored array when present and valid,
 * else the default set. Tolerant: junk entries are dropped, not fatal. */
export function parseCatalogs(config: TokenData["config"], lists: TokenList[]): CatalogDef[] {
  if (!Array.isArray(config.catalogs)) return defaultCatalogs(lists);
  return config.catalogs
    .map((raw) => sanitizeDef(raw, lists))
    .filter((d): d is CatalogDef => d !== null);
}

function catalogEntries(defs: CatalogDef[]) {
  const skip = [{ name: "skip", isRequired: false }];
  const radarExtra = [{ name: "genre", options: REGIONS, isRequired: false }, ...skip];
  return defs
    .filter((d) => d.enabled)
    .map((d) => ({
      type: "movie",
      id: d.id,
      name: d.name,
      extra: isRadarSource(d.source) ? radarExtra : skip,
    }));
}

/** The personal manifest: one Stremio catalog per enabled definition, in the
 * user's order. A dead token (data null) gets an empty-catalog manifest
 * pointing at /configure — never a 404, so stale installs fail soft (#110). */
export function buildPersonalManifest(data: TokenData | null) {
  return {
    id: PERSONAL_ADDON_ID,
    version: "1.0.0",
    name: "Release Notifier (Personal)",
    description: data
      ? `Your watchlist and followed lists plus the Digital Release Radar, ` +
        `filtered and sorted your way. Configure at ${APP_URL}/configure`
      : `This install's token was revoked. Open ${APP_URL}/configure to ` +
        `reinstall with a fresh link.`,
    resources: ["catalog"],
    types: ["movie"],
    idPrefixes: ["tt"],
    catalogs: data ? catalogEntries(parseCatalogs(data.config, data.lists)) : [],
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

/** The anonymous, URL-configured manifest (#118) — same identity and listing
 * metadata as the plain public addon, so a configured install replaces rather
 * than duplicates it. */
export function buildAnonManifest(defs: CatalogDef[]) {
  return { ...anonManifestBase(), catalogs: catalogEntries(defs) };
}

/** Movie plus the overview the meta description needs (the Console's Movie
 * shape has no overview — it rides along untouched through applyControls). */
interface ListMovie extends Movie {
  overview: string | null;
}

function rowToMovie(r: ListRow): ListMovie {
  return {
    id: 0, // unused by sort/filter/meta — the addon keys on imdb ids
    imdbId: r.imdb_id,
    tmdbId: r.tmdb_id,
    title: r.title,
    year: r.year,
    posterPath: r.poster_path,
    theatricalDate: r.theatrical_date,
    theatricalRegion: null,
    digitalDate: r.digital_date,
    digitalRegion: null,
    genres: [],
    imdbRating: r.imdb_rating,
    imdbVotes: r.imdb_votes,
    tmdbRating: r.tmdb_rating,
    tmdbVotes: r.tmdb_votes,
    popularity: r.popularity,
    addedAt: r.added_at,
    providersBG: [],
    overview: r.overview,
  };
}

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

function movieToMeta(m: ListMovie): Meta {
  const description = [m.digitalDate ? `Digital: ${m.digitalDate}` : null, m.overview]
    .filter(Boolean)
    .join("\n\n");
  return {
    id: m.imdbId!,
    type: "movie",
    name: m.title ?? m.imdbId!,
    poster: m.posterPath ? `${TMDB_IMG}${m.posterPath}` : undefined,
    posterShape: "poster",
    description: description || undefined,
    releaseInfo: m.year != null ? String(m.year) : undefined,
  };
}

/** One list-catalog page: status filter → minVotes + sort (the Console's
 * applyControls) → paginate → metas. Rows without an imdb id are dropped
 * up front (Stremio keys on `tt` ids). */
export function buildListMetas(
  rows: ListRow[],
  def: CatalogDef,
  skip: number,
  today = todayISO(),
): Meta[] {
  const movies = rows.map(rowToMovie).filter((m) => m.imdbId != null);
  const byStatus = def.status
    ? movies.filter((m) => statusOf(m, today) === def.status)
    : movies;
  const ordered =
    def.sort.key === "rank"
      ? // Keep the caller's order (radar rows arrive rank-ordered); the vote
        // floor still applies, so filter here rather than through applyControls.
        byStatus.filter((m) => def.minVotes == null || effectiveVotes(m) >= def.minVotes)
      : (applyControls(
          byStatus,
          {
            sort: { key: def.sort.key, dir: def.sort.dir },
            filters: {
              providers: [],
              genres: [],
              yearMin: null,
              yearMax: null,
              minVotes: def.minVotes,
            },
          },
          today,
        ) as ListMovie[]);
  return ordered.slice(skip, skip + PAGE_SIZE).map(movieToMeta);
}

/** Every radar row for one region × window, rank-ordered, shaped like a list
 * row so both catalog kinds run through {@link buildListMetas}. Radar sets are
 * tiny (tens of rows per region/window), so this fetches the lot and lets the
 * Worker sort — the alternative, sorting in SQL, can't express the Console's
 * ladder. The one impure function here, mirroring stremio-core's. */
export async function fetchRadarRows(
  base: string,
  anonKey: string,
  window: "recent" | "upcoming",
  region: string,
  fetchFn: typeof fetch = fetch,
): Promise<ListRow[]> {
  const params = new URLSearchParams({
    select:
      "digital_date,movies!inner(imdb_id,tmdb_id,title,poster_path,year,overview," +
      "theatrical_date,imdb_rating,imdb_votes,tmdb_rating,tmdb_votes,popularity)",
    region: `eq.${region}`,
    window: `eq.${window}`,
    "movies.imdb_id": "not.is.null",
    order: "rank.asc",
    limit: "500",
  });
  const res = await fetchFn(`${base}/rest/v1/radar_entries?${params}`, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as {
    digital_date: string;
    movies: Omit<ListRow, "digital_date" | "added_at"> | null;
  }[];
  return rows
    .filter((r) => r.movies != null)
    .map((r) => ({ ...r.movies!, digital_date: r.digital_date, added_at: null }));
}
