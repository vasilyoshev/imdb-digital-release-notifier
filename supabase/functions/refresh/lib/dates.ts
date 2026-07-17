import type { Effective, Medium, RawDate } from "./types.ts";

export function computeEffective(
  raw: RawDate[],
  regionOrder: string[],
  medium: Medium,
): Effective | null {
  for (const region of regionOrder) {
    const hit = raw.find((d) => d.medium === medium && d.region === region);
    if (hit) return { date: hit.date, region };
  }
  return null;
}

/**
 * The single global region cascade that drives the shared movie_events stream
 * (SPEC §8 job 1: "recompute effective dates per the union of user cascades").
 *
 * Each region's priority is the best (lowest) rank any user's cascade gives it;
 * ties break by the supported-regions position. With a single user this returns
 * that user's cascade verbatim — so the owner's global dates stay v1-equivalent
 * across the cutover while extra signups only ever *add* lower-priority regions.
 */
export function buildGlobalCascade(cascades: string[][], supportedOrder: string[]): string[] {
  const bestRank = new Map<string, number>();
  for (const cascade of cascades) {
    cascade.forEach((region, rank) => {
      const prev = bestRank.get(region);
      if (prev === undefined || rank < prev) bestRank.set(region, rank);
    });
  }
  const pos = (r: string) => {
    const i = supportedOrder.indexOf(r);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...bestRank.keys()].sort((a, b) => bestRank.get(a)! - bestRank.get(b)! || pos(a) - pos(b));
}

/** Current wall-clock hour (0–23) in an IANA timezone. */
export function hourInZone(timezone: string, now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

/** Today's date (YYYY-MM-DD) in an IANA timezone. */
export function dateInZone(timezone: string, now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: timezone });
}
