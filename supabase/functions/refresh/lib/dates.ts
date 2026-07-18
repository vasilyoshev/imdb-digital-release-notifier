import type { Effective, Medium, RawDate } from "./types.ts";

/**
 * The effective date for a medium is the EARLIEST release date across every
 * region we track (decided 2026-07-18): "when did this first hit theatrical /
 * digital, anywhere". A late regional re-release (e.g. a 2003 film re-listed as
 * digital in one region in 2025) no longer masks the original date. Ties break
 * by `regionOrder` priority, then region code, so the result is deterministic.
 */
export function computeEffective(
  raw: RawDate[],
  regionOrder: string[],
  medium: Medium,
): Effective | null {
  const priority = (r: string) => {
    const i = regionOrder.indexOf(r);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  let best: RawDate | null = null;
  for (const d of raw) {
    if (d.medium !== medium) continue;
    if (
      best === null ||
      d.date < best.date ||
      (d.date === best.date && priority(d.region) < priority(best.region)) ||
      (d.date === best.date && priority(d.region) === priority(best.region) && d.region < best.region)
    ) {
      best = d;
    }
  }
  return best ? { date: best.date, region: best.region } : null;
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
