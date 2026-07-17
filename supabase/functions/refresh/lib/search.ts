import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getUserTrackedMovies } from "./db.ts";
import { searchMovies } from "./tmdb.ts";

export interface SearchHit {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  /** Already on one of the caller's lists — the dropdown shows its status. */
  tracked: boolean;
  digitalDate: string | null;
}

/** SPEC §11 — proxy TMDb search and annotate each hit with whether the caller
 * already tracks it (so the dropdown can show digital status / hide Follow). */
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
  return results.map((r) => ({
    ...r,
    tracked: tracked.has(r.tmdbId),
    digitalDate: tracked.get(r.tmdbId) ?? null,
  }));
}
