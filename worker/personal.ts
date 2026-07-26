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
  type Movie,
  STATUS_ORDER,
  statusOf,
  todayISO,
} from "../src/lib/dashboard";
import { APP_URL, CATALOGS, type Meta, PAGE_SIZE, REGIONS } from "./stremio-core";

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

/** One user-defined catalog, fully resolved (defaults filled in). */
export interface CatalogDef {
  id: string;
  name: string;
  source: CatalogSource;
  enabled: boolean;
  sort: { key: SortKey; dir: SortDir };
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
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : fallbackName,
    source,
    enabled: r.enabled !== false,
    sort: {
      key: SORT_KEYS.includes(sort.key as SortKey) ? (sort.key as SortKey) : "digital",
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
      sort: { key: "digital", dir: "desc" },
      minVotes: null,
      status: null,
      region: "US",
    });
  }
  return defs;
}

/** The user's catalogs, in order — the stored array when present and valid,
 * else the default set. Tolerant: junk entries are dropped, not fatal. */
export function parseCatalogs(config: TokenData["config"], lists: TokenList[]): CatalogDef[] {
  if (!Array.isArray(config.catalogs)) return defaultCatalogs(lists);
  return config.catalogs
    .map((raw) => sanitizeDef(raw, lists))
    .filter((d): d is CatalogDef => d !== null);
}

/** The personal manifest: one Stremio catalog per enabled definition, in the
 * user's order. A dead token (data null) gets an empty-catalog manifest
 * pointing at /configure — never a 404, so stale installs fail soft (#110). */
export function buildPersonalManifest(data: TokenData | null) {
  const skip = [{ name: "skip", isRequired: false }];
  const radarExtra = [{ name: "genre", options: REGIONS, isRequired: false }, ...skip];
  const catalogs = data
    ? parseCatalogs(data.config, data.lists)
        .filter((d) => d.enabled)
        .map((d) => ({
          type: "movie",
          id: d.id,
          name: d.name,
          extra: isRadarSource(d.source) ? radarExtra : skip,
        }))
    : [];
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
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
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
  const sorted = applyControls(
    byStatus,
    {
      sort: def.sort,
      filters: { providers: [], genres: [], yearMin: null, yearMax: null, minVotes: def.minVotes },
    },
    today,
  ) as ListMovie[];
  return sorted.slice(skip, skip + PAGE_SIZE).map(movieToMeta);
}
