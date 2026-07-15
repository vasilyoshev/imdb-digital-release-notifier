// PROTOTYPE — throwaway mock data for the dashboard/calendar UI prototype
// (wayfinder ticket #8). Not production code; delete with the route.
// "Today" is frozen so derived statuses are stable while judging the UI.

export const TODAY = "2026-07-15";

export type Region = "BG" | "US" | "GB";
export type Medium = "theatrical" | "digital";
export type DerivedStatus =
  | "Unmatched"
  | "Waiting"
  | "Announced"
  | "In theaters"
  | "Out now";

export type EffectiveDate = { date: string; region: Region };
export type Provider = { name: string; kind: "stream" | "rent" | "buy" };

export type Movie = {
  imdbId: string;
  title: string;
  year: number;
  hue: number; // poster placeholder color
  unmatched?: boolean;
  theatrical?: EffectiveDate;
  digital?: EffectiveDate;
  providersBG: Provider[];
};

export const MOVIES: Movie[] = [
  {
    imdbId: "tt31193180",
    title: "Sinners",
    year: 2025,
    hue: 0,
    theatrical: { date: "2025-04-18", region: "BG" },
    digital: { date: "2026-07-08", region: "BG" },
    providersBG: [
      { name: "HBO Max", kind: "stream" },
      { name: "Apple TV", kind: "rent" },
    ],
  },
  {
    imdbId: "tt12345678",
    title: "Mickey 17",
    year: 2025,
    hue: 210,
    theatrical: { date: "2025-03-07", region: "BG" },
    digital: { date: "2026-05-12", region: "US" },
    providersBG: [
      { name: "HBO Max", kind: "stream" },
      { name: "Apple TV", kind: "rent" },
      { name: "Google Play", kind: "buy" },
    ],
  },
  {
    imdbId: "tt15239678",
    title: "Dune: Part Three",
    year: 2026,
    hue: 35,
    theatrical: { date: "2026-07-03", region: "BG" },
    digital: { date: "2026-09-22", region: "US" },
    providersBG: [],
  },
  {
    imdbId: "tt22222222",
    title: "28 Years Later: The Bone Temple",
    year: 2026,
    hue: 120,
    theatrical: { date: "2026-06-26", region: "BG" },
    digital: { date: "2026-08-18", region: "US" },
    providersBG: [],
  },
  {
    imdbId: "tt33333333",
    title: "Avatar: Fire and Ash",
    year: 2025,
    hue: 190,
    theatrical: { date: "2025-12-19", region: "BG" },
    digital: { date: "2026-07-28", region: "US" },
    providersBG: [],
  },
  {
    imdbId: "tt44444444",
    title: "The Odyssey",
    year: 2026,
    hue: 260,
    theatrical: { date: "2026-07-17", region: "BG" },
    providersBG: [],
  },
  {
    imdbId: "tt55555555",
    title: "Project Hail Mary",
    year: 2026,
    hue: 45,
    theatrical: { date: "2026-08-20", region: "US" },
    providersBG: [],
  },
  {
    imdbId: "tt66666666",
    title: "Supergirl",
    year: 2026,
    hue: 340,
    theatrical: { date: "2026-08-28", region: "GB" },
    providersBG: [],
  },
  {
    imdbId: "tt77777777",
    title: "The Batman Part II",
    year: 2027,
    hue: 15,
    theatrical: { date: "2026-10-01", region: "US" },
    providersBG: [],
  },
  {
    imdbId: "tt88888888",
    title: "Hamnet",
    year: 2026,
    hue: 90,
    providersBG: [],
  },
  {
    imdbId: "tt99999999",
    title: "The Dog Stars",
    year: 2026,
    hue: 160,
    providersBG: [],
  },
  {
    imdbId: "tt10101010",
    title: "Klara and the Sun",
    year: 2026,
    hue: 300,
    unmatched: true,
    providersBG: [],
  },
];

export const statusOf = (m: Movie): DerivedStatus => {
  if (m.unmatched) return "Unmatched";
  if (!m.theatrical && !m.digital) return "Waiting";
  const released = (d?: EffectiveDate) => !!d && d.date <= TODAY;
  if (released(m.digital)) return "Out now";
  if (released(m.theatrical)) return "In theaters";
  return "Announced";
};

export const STATUS_ORDER: DerivedStatus[] = [
  "Out now",
  "In theaters",
  "Announced",
  "Waiting",
  "Unmatched",
];

export type LogKind =
  | "theatrical_announced"
  | "digital_announced"
  | "theatrical_released"
  | "digital_released"
  | "date_changed";

export type LogEntry = {
  at: string; // ISO datetime
  kind: LogKind;
  movie: string;
  detail: string;
};

export const NOTIFICATION_LOG: LogEntry[] = [
  {
    at: "2026-07-15T09:02:00",
    kind: "digital_released",
    movie: "Sinners",
    detail: "Out now — streaming on HBO Max (BG)",
  },
  {
    at: "2026-07-15T09:02:00",
    kind: "date_changed",
    movie: "28 Years Later: The Bone Temple",
    detail: "Digital moved 25 Aug → 18 Aug 2026 (US)",
  },
  {
    at: "2026-07-11T09:01:00",
    kind: "digital_announced",
    movie: "Avatar: Fire and Ash",
    detail: "Digital on 28 Jul 2026 (US)",
  },
  {
    at: "2026-07-03T09:01:00",
    kind: "theatrical_released",
    movie: "Dune: Part Three",
    detail: "In theaters (BG)",
  },
  {
    at: "2026-07-01T09:00:00",
    kind: "theatrical_announced",
    movie: "The Odyssey",
    detail: "Theatrical on 17 Jul 2026 (BG)",
  },
  {
    at: "2026-06-26T09:01:00",
    kind: "theatrical_released",
    movie: "28 Years Later: The Bone Temple",
    detail: "In theaters (BG)",
  },
  {
    at: "2026-06-20T09:00:00",
    kind: "digital_announced",
    movie: "Dune: Part Three",
    detail: "Digital on 22 Sep 2026 (US)",
  },
  {
    at: "2026-06-14T09:00:00",
    kind: "theatrical_announced",
    movie: "The Batman Part II",
    detail: "Theatrical on 1 Oct 2026 (US)",
  },
];

export const LOG_ICON: Record<LogKind, string> = {
  theatrical_announced: "🎬",
  digital_announced: "📺",
  theatrical_released: "🍿",
  digital_released: "✨",
  date_changed: "📅",
};

export const SETTINGS = {
  watchlistUrl: "https://www.imdb.com/user/ur12345678/watchlist",
  regionOrder: ["BG", "US", "GB"] as Region[],
  notifyEmail: "vasil.yoshev@gmail.com",
  gateHour: "09:00 (Europe/Sofia)",
  paused: false,
  pushDevices: ["Pixel 9 Pro", "iPhone (Home Screen)"],
};

export const LAST_RUN = { at: "2026-07-15T09:02:00", eventsSent: 2 };

// ---- date helpers -------------------------------------------------------

export const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const fmtFull = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export type UpcomingEvent = {
  movie: Movie;
  medium: Medium;
  date: string;
  region: Region;
};

export const upcomingEvents = (): UpcomingEvent[] =>
  MOVIES.flatMap((movie) =>
    (["theatrical", "digital"] as Medium[])
      .map((medium) => ({ medium, eff: movie[medium] }))
      .filter((x) => x.eff && x.eff.date > TODAY)
      .map((x) => ({
        movie,
        medium: x.medium,
        date: x.eff!.date,
        region: x.eff!.region,
      })),
  ).sort((a, b) => a.date.localeCompare(b.date));

/** All events (past + future) landing in the given month (0-based). */
export const eventsInMonth = (year: number, month: number): UpcomingEvent[] =>
  MOVIES.flatMap((movie) =>
    (["theatrical", "digital"] as Medium[])
      .map((medium) => ({ medium, eff: movie[medium] }))
      .filter((x) => {
        if (!x.eff) return false;
        const d = new Date(x.eff.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map((x) => ({
        movie,
        medium: x.medium,
        date: x.eff!.date,
        region: x.eff!.region,
      })),
  );
