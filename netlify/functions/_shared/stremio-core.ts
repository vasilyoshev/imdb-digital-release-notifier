/**
 * Pure logic for the "Digital Release Radar" Stremio addon (SPEC §12). No SDK:
 * the addon is catalogs-only HTTP + JSON, reading radar_entries + movies through
 * the anon PostgREST surface. Kept side-effect-free (bar the one fetch helper)
 * so the shapes can be unit-tested without the Netlify runtime.
 */

export const ADDON_ID = "uk.yoshevbot.release-notifier.radar";
export const APP_URL = "https://release-notifier.netlify.app";
/** The regions offered in the catalog "genre" dropdown (SPEC §12). */
export const REGIONS = ["US", "BG", "GB", "DE"];
export const PAGE_SIZE = 100;

const CATALOGS = [
  { id: "new-digital", name: "New on digital", window: "recent" as const },
  { id: "upcoming-digital", name: "Upcoming digital", window: "upcoming" as const },
];

export function windowForCatalog(catalogId: string): "recent" | "upcoming" | null {
  return CATALOGS.find((c) => c.id === catalogId)?.window ?? null;
}

/** The addon manifest (SPEC §12). Both catalogs, region-in-genre, extras optional
 * so the rows also appear on the Board. */
export function buildManifest() {
  const extra = [
    { name: "genre", options: REGIONS, isRequired: false },
    { name: "skip", isRequired: false },
  ];
  return {
    id: ADDON_ID,
    version: "1.0.0",
    name: "Digital Release Radar",
    description:
      `Recently-released and upcoming digital movie releases, region by region. ` +
      `Powered by ${APP_URL}`,
    resources: ["catalog"],
    types: ["movie"],
    idPrefixes: ["tt"],
    catalogs: CATALOGS.map((c) => ({ type: "movie", id: c.id, name: c.name, extra })),
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

export interface CatalogExtras {
  region: string;
  skip: number;
}

/** Parse the optional extras path segment (`genre=BG&skip=100`, url-encoded) into
 * a region (default US) + skip offset. Unknown regions fall back to US. */
export function parseExtras(raw: string | undefined): CatalogExtras {
  const out: CatalogExtras = { region: "US", skip: 0 };
  if (!raw) return out;
  const decoded = decodeURIComponent(raw);
  for (const pair of decoded.split("&")) {
    const [k, v] = pair.split("=");
    if (k === "genre" && v && REGIONS.includes(v)) out.region = v;
    if (k === "skip") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out.skip = Math.floor(n);
    }
  }
  return out;
}

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

export interface RadarMovieRow {
  digital_date: string;
  movies: {
    imdb_id: string | null;
    title: string | null;
    poster_path: string | null;
    year: number | null;
    overview: string | null;
  } | null;
}

export interface Meta {
  id: string;
  type: "movie";
  name: string;
  poster?: string;
  posterShape: "poster";
  description?: string;
  releaseInfo?: string;
}

/** A radar row → a Stremio Meta Preview. Rows without an imdb id are dropped
 * (Cinemeta keys on `tt` ids); the digital date leads the description. */
export function toMeta(row: RadarMovieRow): Meta | null {
  const m = row.movies;
  if (!m?.imdb_id) return null;
  const date = row.digital_date;
  const description = [`Digital: ${date}`, m.overview].filter(Boolean).join("\n\n");
  return {
    id: m.imdb_id,
    type: "movie",
    name: m.title ?? m.imdb_id,
    poster: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : undefined,
    posterShape: "poster",
    description,
    releaseInfo: m.year != null ? String(m.year) : undefined,
  };
}

/** Fetch one catalog page from the anon PostgREST surface and map to metas. */
export async function fetchCatalog(
  base: string,
  anonKey: string,
  window: "recent" | "upcoming",
  region: string,
  skip: number,
  fetchFn: typeof fetch = fetch,
): Promise<Meta[]> {
  const params = new URLSearchParams({
    select: "digital_date,movies!inner(imdb_id,title,poster_path,year,overview)",
    region: `eq.${region}`,
    window: `eq.${window}`,
    "movies.imdb_id": "not.is.null",
    order: "rank.asc",
    offset: String(skip),
    limit: String(PAGE_SIZE),
  });
  const res = await fetchFn(`${base}/rest/v1/radar_entries?${params}`, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as RadarMovieRow[];
  return rows.map(toMeta).filter((m): m is Meta => m !== null);
}
