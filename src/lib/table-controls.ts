/**
 * Table sort + filter controls (SPEC §10, decided in #44): pure state + logic
 * for the movie table's clickable-header sort and the provider/genre/year filter
 * toolbar. State persists per list/tab in localStorage — no DB writes, so it
 * works anonymously. Status filtering stays on the stat strip (Dashboard), and
 * composes with these before the sort runs.
 */
import { type Movie, STATUS_ORDER, statusOf } from "./dashboard";

export type SortKey = "title" | "digital" | "theatrical" | "status" | "year";
export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export interface Filters {
  providers: string[];
  genres: string[];
  yearMin: number | null;
  yearMax: number | null;
}

export interface TableControls {
  sort: SortState;
  filters: Filters;
}

/** Each column's first-click direction; a second click on the active column flips
 * it. The table default is digital-newest-first (SPEC §10). */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  title: "asc",
  digital: "desc",
  theatrical: "desc",
  status: "asc", // ladder order: Out now first
  year: "desc",
};

export function defaultControls(): TableControls {
  return {
    sort: { key: "digital", dir: "desc" },
    filters: { providers: [], genres: [], yearMin: null, yearMax: null },
  };
}

/** Toggle sort on a header click: same column flips direction, a new column
 * starts at its natural default direction. */
export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: DEFAULT_DIR[key] };
}

export interface FilterOptions {
  providers: string[];
  genres: string[];
  yearBounds: { min: number; max: number } | null;
}

/** The filter choices actually present in the current movie set — provider
 * names (active region) and genres are unioned and sorted; the year bounds span
 * the movies that have a year. Built from the unfiltered list so options are
 * stable as filters are toggled. */
export function deriveOptions(movies: Movie[]): FilterOptions {
  const providers = new Set<string>();
  const genres = new Set<string>();
  const years: number[] = [];
  for (const m of movies) {
    for (const p of m.providersBG) providers.add(p.name);
    for (const g of m.genres) genres.add(g);
    if (m.year != null) years.push(m.year);
  }
  return {
    providers: [...providers].sort((a, b) => a.localeCompare(b)),
    genres: [...genres].sort((a, b) => a.localeCompare(b)),
    yearBounds: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
  };
}

export function filtersActive(f: Filters): boolean {
  return f.providers.length > 0 || f.genres.length > 0 || f.yearMin != null || f.yearMax != null;
}

function passesFilters(m: Movie, f: Filters): boolean {
  if (f.providers.length && !m.providersBG.some((p) => f.providers.includes(p.name))) return false;
  if (f.genres.length && !m.genres.some((g) => f.genres.includes(g))) return false;
  if (f.yearMin != null && (m.year == null || m.year < f.yearMin)) return false;
  if (f.yearMax != null && (m.year == null || m.year > f.yearMax)) return false;
  return true;
}

/** Compare two movies on one key, ascending, with missing values sorted last
 * regardless of direction; ties fall through to title. */
function compareBy(a: Movie, b: Movie, key: SortKey, today: string): number {
  switch (key) {
    case "title":
      return (a.title ?? "").localeCompare(b.title ?? "");
    case "status":
      return STATUS_ORDER.indexOf(statusOf(a, today)) - STATUS_ORDER.indexOf(statusOf(b, today));
    case "year":
      return nullsLastNum(a.year, b.year);
    case "digital":
      return nullsLastStr(a.digitalDate, b.digitalDate);
    case "theatrical":
      return nullsLastStr(a.theatricalDate, b.theatricalDate);
  }
}

function nullsLastNum(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return Number.POSITIVE_INFINITY;
  if (b == null) return Number.NEGATIVE_INFINITY;
  return a - b;
}

function nullsLastStr(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return Number.POSITIVE_INFINITY;
  if (b == null) return Number.NEGATIVE_INFINITY;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Apply the toolbar filters then the active sort (missing values always last,
 * title as the stable tiebreak). Pure — status filtering is applied upstream. */
export function applyControls(movies: Movie[], controls: TableControls, today: string): Movie[] {
  const { key, dir } = controls.sort;
  const flip = dir === "desc" ? -1 : 1;
  return movies
    .filter((m) => passesFilters(m, controls.filters))
    .sort((a, b) => {
      const base = compareBy(a, b, key, today);
      // Missing values (±Infinity) always sort last — don't let `flip` move them.
      if (!Number.isFinite(base)) return base > 0 ? 1 : -1;
      if (base !== 0) return base * flip;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
}

// ---- Per-list persistence (localStorage) --------------------------------

const KEY_PREFIX = "table-controls:";

export function loadControls(listId: number | string): TableControls {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + listId);
    if (!raw) return defaultControls();
    const parsed = JSON.parse(raw) as Partial<TableControls>;
    const d = defaultControls();
    return {
      sort: parsed.sort ?? d.sort,
      filters: { ...d.filters, ...parsed.filters },
    };
  } catch {
    return defaultControls();
  }
}

export function saveControls(listId: number | string, controls: TableControls): void {
  try {
    localStorage.setItem(KEY_PREFIX + listId, JSON.stringify(controls));
  } catch {
    // storage unavailable / quota — controls simply won't persist.
  }
}
