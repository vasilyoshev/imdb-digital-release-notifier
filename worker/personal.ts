/**
 * Personalized (token'd) Stremio addon surface (map #109, ticket #112). Pure
 * logic: a 48-hex addon token resolves to a server-side per-catalog config via
 * two anon-key RPCs (migration 20260726090000) — stremio_config_by_token for
 * the manifest, stremio_list_movies for one list's rows. Sorting, filtering,
 * and the status ladder reuse the Console's pure table logic (src/lib) so the
 * addon and the web table can never disagree.
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
  config: { catalogs?: Record<string, unknown> };
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

/** One catalog's options after defaults (the #111 config contract: a missing
 * catalog key or field means default, so `{}` is a fully valid config). */
export interface CatalogCfg {
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

/** Merge a stored per-catalog entry with the defaults, tolerantly — unknown
 * values fall back rather than erroring, since the DB only enforces "object". */
export function catalogCfg(config: TokenData["config"], catalogId: string): CatalogCfg {
  const catalogs = config.catalogs;
  const raw =
    (catalogs && typeof catalogs === "object"
      ? (catalogs[catalogId] as Record<string, unknown> | undefined)
      : undefined) ?? {};
  const sort = (raw.sort ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled !== false,
    sort: {
      key: SORT_KEYS.includes(sort.key as SortKey) ? (sort.key as SortKey) : "digital",
      dir: sort.dir === "asc" ? "asc" : "desc",
    },
    minVotes: typeof raw.minVotes === "number" && raw.minVotes > 0 ? raw.minVotes : null,
    status: STATUS_ORDER.includes(raw.status as DerivedStatus)
      ? (raw.status as DerivedStatus)
      : null,
    region: typeof raw.region === "string" && /^[A-Z]{2}$/.test(raw.region) ? raw.region : "US",
  };
}

/** The personal manifest: one catalog per enabled list + the enabled radar
 * catalogs. A dead token (data null) gets an empty-catalog manifest pointing
 * at /configure — never a 404, so stale installs fail soft (#110). */
export function buildPersonalManifest(data: TokenData | null) {
  const catalogs: { type: string; id: string; name: string; extra: object[] }[] = [];
  if (data) {
    const skip = [{ name: "skip", isRequired: false }];
    for (const l of data.lists) {
      const cfg = catalogCfg(data.config, `list-${l.id}`);
      if (!cfg.enabled) continue;
      catalogs.push({ type: "movie", id: `list-${l.id}`, name: l.name, extra: skip });
    }
    for (const c of CATALOGS) {
      const cfg = catalogCfg(data.config, c.id);
      if (!cfg.enabled) continue;
      catalogs.push({
        type: "movie",
        id: c.id,
        name: c.name,
        extra: [{ name: "genre", options: REGIONS, isRequired: false }, ...skip],
      });
    }
  }
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
  cfg: CatalogCfg,
  skip: number,
  today = todayISO(),
): Meta[] {
  const movies = rows.map(rowToMovie).filter((m) => m.imdbId != null);
  const byStatus = cfg.status
    ? movies.filter((m) => statusOf(m, today) === cfg.status)
    : movies;
  const sorted = applyControls(
    byStatus,
    {
      sort: cfg.sort,
      filters: { providers: [], genres: [], yearMin: null, yearMax: null, minVotes: cfg.minVotes },
    },
    today,
  ) as ListMovie[];
  return sorted.slice(skip, skip + PAGE_SIZE).map(movieToMeta);
}
