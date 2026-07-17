// Pure helpers for the Digital Release Radar (SPEC §4). The orchestrator does
// the discover calls + hydration; these turn a window + verified per-region
// digital dates into ranked radar_entries rows, side-effect-free for tests.

export type RadarWindow = "recent" | "upcoming";

export interface DateRange {
  gte: string; // YYYY-MM-DD inclusive
  lte: string; // YYYY-MM-DD inclusive
}

function shift(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** The discover window for a radar bucket, anchored on `today` (owner tz):
 * recent = [today - recentDays, today]; upcoming = [today, today + upcomingDays]. */
export function radarWindow(
  today: string,
  window: RadarWindow,
  recentDays: number,
  upcomingDays: number,
): DateRange {
  return window === "recent"
    ? { gte: shift(today, -recentDays), lte: today }
    : { gte: today, lte: shift(today, upcomingDays) };
}

export interface RadarRow {
  region: string;
  window: RadarWindow;
  movie_id: number;
  rank: number;
  digital_date: string;
}

/**
 * Verify discover candidates against their hydrated per-region digital date and
 * rank them (SPEC §4 "trust but verify"): drop any movie whose real digital date
 * for this region is missing or falls outside the window (discover's top-level
 * date leaks), dedupe, then rank — newest-first for recent, soonest-first for
 * upcoming. `rank` is dense from 0 in that order.
 */
export function buildRadarRows(
  movieIds: number[],
  region: string,
  window: RadarWindow,
  range: DateRange,
  digitalDateOf: Map<number, string>,
): RadarRow[] {
  const seen = new Set<number>();
  const kept: { movie_id: number; digital_date: string }[] = [];
  for (const id of movieIds) {
    if (seen.has(id)) continue;
    const dd = digitalDateOf.get(id);
    if (!dd || dd < range.gte || dd > range.lte) continue; // leak / unhydrated → skip
    seen.add(id);
    kept.push({ movie_id: id, digital_date: dd });
  }
  kept.sort((a, b) => {
    if (a.digital_date === b.digital_date) return a.movie_id - b.movie_id;
    const cmp = a.digital_date < b.digital_date ? -1 : 1;
    return window === "recent" ? -cmp : cmp;
  });
  return kept.map((e, i) => ({ region, window, movie_id: e.movie_id, rank: i, digital_date: e.digital_date }));
}
