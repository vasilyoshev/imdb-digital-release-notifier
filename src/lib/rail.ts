/**
 * Side-rail domain: the Upcoming timeline (future effective dates across all
 * active movies — this *is* the calendar) and the History feed (the visible
 * notification log). Pure derivation + formatting; queries live in queries.ts.
 */
import { fmtFull, todayISO } from "./dashboard";

export type Medium = "theatrical" | "digital";

/** A movie reduced to what the rail needs (no providers/poster). */
export interface ActiveMovie {
  id: number;
  title: string | null;
  theatricalDate: string | null;
  theatricalRegion: string | null;
  digitalDate: string | null;
  digitalRegion: string | null;
}

export interface UpcomingEvent {
  movieId: number;
  title: string;
  medium: Medium;
  date: string;
  region: string | null;
}

/** A movie that's out in theaters but has no digital date announced yet — it
 *  belongs on the Upcoming rail (a digital release is coming) even though there's
 *  no date to place it at. Mirrors the "Awaiting digital" status. */
export interface AwaitingMovie {
  movieId: number;
  title: string;
  theatricalDate: string;
  region: string | null;
}

export interface LogEntry {
  id: number;
  channel: "push" | "email";
  event: "announced" | "released" | "date_changed";
  medium: Medium;
  effectiveDate: string;
  sentAt: string;
  movieTitle: string;
}

export const MEDIUM_ICON: Record<Medium, string> = {
  theatrical: "🎬",
  digital: "📺",
};

/** Future effective dates across all active movies, chronological. */
export function upcomingFrom(
  movies: ActiveMovie[],
  today = todayISO(),
): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];
  for (const m of movies) {
    const pairs: [Medium, string | null, string | null][] = [
      ["theatrical", m.theatricalDate, m.theatricalRegion],
      ["digital", m.digitalDate, m.digitalRegion],
    ];
    for (const [medium, date, region] of pairs) {
      if (date && date > today) {
        events.push({
          movieId: m.id,
          title: m.title ?? "Untitled",
          medium,
          date,
          region,
        });
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** Active movies awaiting a digital release: theatrical is out (within the last
 *  year — matching the "Awaiting digital" status), no digital date yet. Undated,
 *  so listed most-recent-theatrical first. */
export function awaitingFrom(
  movies: ActiveMovie[],
  today = todayISO(),
): AwaitingMovie[] {
  const oneYearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return movies
    .filter(
      (m) =>
        !m.digitalDate &&
        m.theatricalDate != null &&
        m.theatricalDate <= today &&
        m.theatricalDate >= oneYearAgo,
    )
    .map((m) => ({
      movieId: m.id,
      title: m.title ?? "Untitled",
      theatricalDate: m.theatricalDate!,
      region: m.theatricalRegion,
    }))
    .sort((a, b) => b.theatricalDate.localeCompare(a.theatricalDate));
}

/** One-line description of a logged event for the History feed. */
export function describeLog(e: LogEntry): { icon: string; text: string } {
  const mediumLabel = e.medium === "theatrical" ? "Theatrical" : "Digital";
  switch (e.event) {
    case "announced":
      return {
        icon: MEDIUM_ICON[e.medium],
        text: `${mediumLabel} announced — ${fmtFull(e.effectiveDate)}`,
      };
    case "released":
      return {
        icon: e.medium === "theatrical" ? "🍿" : "✨",
        text:
          e.medium === "theatrical"
            ? `In theaters — ${fmtFull(e.effectiveDate)}`
            : `Out now — ${fmtFull(e.effectiveDate)}`,
      };
    case "date_changed":
      return {
        icon: "📅",
        text: `${mediumLabel} date changed → ${fmtFull(e.effectiveDate)}`,
      };
  }
}

/** Compact "15 Jul 2026 · 09:02" for the sent-at stamp. */
export function fmtSent(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/** Short "17 Jul 2026" chip for the Upcoming timeline. */
export function fmtChip(iso: string): string {
  return fmtFull(iso);
}
