/**
 * Settings + run-control domain: the user's `settings` row, the `refresh_runs`
 * summary the navbar shows, and the payload "Refresh now" returns. Writes go
 * through RLS-permitted UPDATE on the user's own `settings` and `lists` rows
 * (SPEC v2 §13).
 */

export interface Settings {
  regionCascade: string[];
  notifyEmail: string | null;
  notificationsPaused: boolean;
  notifyHour: number;
}

export interface RefreshRun {
  id: number;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "error";
  moviesTotal: number | null;
  moviesMatched: number | null;
  eventsCreated: number | null;
  notificationsSent: number | null;
  error: string | null;
}

/** What the refresh Edge Function returns on a completed manual run. */
export interface RefreshSummary {
  runId: number;
  moviesTotal: number;
  moviesMatched: number;
  eventsCreated: number;
  notificationsSent: number;
}

export interface PushDevice {
  id: number;
  endpoint: string;
  createdAt: string;
}

/** IMDb watchlist list config (kind = imdb_watchlist). */
export interface WatchlistConfig {
  imdb_user_id?: string;
}

/** Accepts a `ur…` id or a full IMDb URL and returns the bare user id. */
export function parseImdbUserId(input: string): string {
  const m = input.match(/ur\d+/i);
  return m ? m[0] : input.trim();
}
