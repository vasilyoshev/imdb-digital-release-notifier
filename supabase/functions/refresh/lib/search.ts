import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getUserTrackedMovies } from "./db.ts";
import { searchMovies } from "./tmdb.ts";

export interface SearchHit {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  /** On the caller's manual Followed list — toggleable in the dropdown. */
  followed: boolean;
  /** On the caller's IMDb watchlist — shown as a status, not a toggle. */
  onWatchlist: boolean;
  digitalDate: string | null;
}

/** SPEC §11 — proxy TMDb search and annotate each hit with how the caller tracks
 * it (manual follow vs IMDb watchlist), so the dropdown shows the right control. */
export async function runSearch(
  db: SupabaseClient,
  userId: string,
  query: string,
  tmdbToken: string,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const [results, tracked] = await Promise.all([
    searchMovies(query, tmdbToken),
    getUserTrackedMovies(db, userId),
  ]);
  return results.map((r) => {
    const t = tracked.get(r.tmdbId);
    return {
      ...r,
      followed: t?.followed ?? false,
      onWatchlist: t?.onWatchlist ?? false,
      digitalDate: t?.digitalDate ?? null,
    };
  });
}
