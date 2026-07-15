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

export function sofiaToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });
}

export function sofiaHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Sofia",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}
