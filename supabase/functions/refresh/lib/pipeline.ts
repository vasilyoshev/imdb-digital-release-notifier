// Pure orchestration helpers for the v2 pipeline (SPEC §8). DB I/O lives in
// db.ts; the live TMDB/IMDB calls live in tmdb.ts/imdb.ts — this module is the
// deterministic decision logic between them, kept side-effect-free for tests.

export interface HydrationCandidate {
  id: number;
  /** ISO timestamp of the last hydration, or null when never hydrated. */
  refreshed_at: string | null;
}

export interface HydrationPlan {
  toHydrate: number[];
  deferred: number;
}

/**
 * Pick which active movies to hydrate this run under a per-run cap (SPEC §8
 * "Quota guardrails"): never-hydrated first, then oldest `refreshed_at` first,
 * carrying the remainder to the next run. A non-finite / non-positive cap means
 * "no cap" — hydrate everything, defer nothing.
 */
export function selectForHydration(active: HydrationCandidate[], cap: number): HydrationPlan {
  const ordered = [...active].sort((a, b) => {
    if (a.refreshed_at === b.refreshed_at) return a.id - b.id; // stable
    if (a.refreshed_at === null) return -1;
    if (b.refreshed_at === null) return 1;
    return a.refreshed_at < b.refreshed_at ? -1 : 1;
  });
  if (!Number.isFinite(cap) || cap <= 0 || ordered.length <= cap) {
    return { toHydrate: ordered.map((m) => m.id), deferred: 0 };
  }
  return { toHydrate: ordered.slice(0, cap).map((m) => m.id), deferred: ordered.length - cap };
}

export interface DeliverableEvent {
  id: number;
  movie_id: number;
  /** ISO timestamp the event was detected. */
  created_at: string;
}

/**
 * The events to deliver to one user right now (SPEC §9 "Delivery"). Gates, all
 * required: the user is not paused; the movie sits on one of the user's
 * notifications-enabled lists (encoded as its earliest membership `added_at` in
 * `followedSince`); the event was detected *after* that `added_at` (no history
 * replay on a fresh follow); and it hasn't already been delivered.
 */
export function selectDeliveries(
  events: DeliverableEvent[],
  followedSince: Map<number, string>,
  alreadyDelivered: Set<number>,
  paused: boolean,
): number[] {
  if (paused) return [];
  const out: number[] = [];
  for (const e of events) {
    const addedAt = followedSince.get(e.movie_id);
    if (addedAt === undefined) continue;
    if (e.created_at <= addedAt) continue;
    if (alreadyDelivered.has(e.id)) continue;
    out.push(e.id);
  }
  return out;
}
