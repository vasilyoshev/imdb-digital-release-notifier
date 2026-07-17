import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getAllSettings,
  getKnownImdbIds,
  getMovieByTmdbId,
  getSupportedRegions,
  getUserFollowedList,
  insertMovie,
  upsertMembership,
} from "./db.ts";
import { buildGlobalCascade } from "./dates.ts";
import { fetchMovieBundle } from "./tmdb.ts";
import { applyBundle } from "./orchestrator.ts";

export interface FollowResult {
  tmdbId: number;
  movieId: number | null;
  followed: boolean;
  /** true when this follow inserted + hydrated a previously-untracked movie. */
  hydrated: boolean;
}

/**
 * SPEC §11 — follow/unfollow a movie by tmdb id on the caller's Followed list.
 * Following an untracked movie inserts it and hydrates immediately (dates,
 * poster, providers land at once, via the shared cache); following a tracked one
 * is a pure membership insert. Unfollow soft-removes the membership.
 */
export async function runFollow(
  db: SupabaseClient,
  userId: string,
  tmdbId: number,
  action: "follow" | "unfollow",
  tmdbToken: string,
): Promise<FollowResult> {
  const followed = await getUserFollowedList(db, userId);
  if (!followed) throw new Error("user has no Followed list");

  if (action === "unfollow") {
    const movie = await getMovieByTmdbId(db, tmdbId);
    if (movie) await upsertMembership(db, followed.id, movie.id, false);
    return { tmdbId, movieId: movie?.id ?? null, followed: false, hydrated: false };
  }

  let movie = await getMovieByTmdbId(db, tmdbId);
  let hydrated = false;
  if (!movie) {
    movie = await insertMovie(db, { tmdb_id: tmdbId });
    const [regions, settings, knownImdbIds] = await Promise.all([
      getSupportedRegions(db),
      getAllSettings(db),
      getKnownImdbIds(db),
    ]);
    const cascade = buildGlobalCascade(settings.map((s) => s.region_cascade), regions);
    const bundle = await fetchMovieBundle(tmdbId, tmdbToken, fetch, regions);
    if (bundle) {
      await applyBundle(db, movie, bundle, cascade, knownImdbIds);
      hydrated = true;
    }
  }
  await upsertMembership(db, followed.id, movie.id, true);
  return { tmdbId, movieId: movie.id, followed: true, hydrated };
}
