/**
 * PROTOTYPE (ticket #42) — throwaway seed data for the anonymous Digital
 * Release Radar. Real TMDB titles/posters fetched 2026-07-16 via
 * /discover/movie?with_release_type=4; per-region dates partly invented so
 * switching region visibly reshuffles the buckets. Delete with the prototype.
 */

export type Region = "US" | "BG" | "GB" | "DE";
export const REGIONS: Region[] = ["US", "BG", "GB", "DE"];

/** The prototype's frozen "today" so buckets are stable. */
export const TODAY = "2026-07-16";

export interface RadarProvider {
  name: string;
  kind: "stream" | "rent" | "buy";
}

export interface RadarMovie {
  id: number;
  title: string;
  year: number;
  posterPath: string | null;
  theatricalDate: string | null;
  /** Effective digital date per region (null = nothing known there yet). */
  digital: Partial<Record<Region, string | null>>;
  providers: RadarProvider[];
  popularity: number;
  /** Detail-view extras (ticket #43) — seeded blurbs, not real TMDB text. */
  overview?: string;
  runtime?: number;
  genres?: string[];
}

const NF: RadarProvider = { name: "Netflix", kind: "stream" };
const MAX: RadarProvider = { name: "HBO Max", kind: "stream" };
const DIS: RadarProvider = { name: "Disney+", kind: "stream" };
const PRIME: RadarProvider = { name: "Prime Video", kind: "stream" };
const ATV_R: RadarProvider = { name: "Apple TV", kind: "rent" };
const ATV_B: RadarProvider = { name: "Apple TV", kind: "buy" };
const GP_R: RadarProvider = { name: "Google Play", kind: "rent" };

export const RADAR_MOVIES: RadarMovie[] = [
  {
    id: 1339713, title: "Obsession", year: 2026,
    posterPath: "/bRwnj8WEKBCvmfeUNOukJPwB43K.jpg",
    theatricalDate: "2026-05-08",
    digital: { US: "2026-06-30", BG: "2026-07-08", GB: "2026-06-30", DE: "2026-07-10" },
    providers: [NF, ATV_R, GP_R], popularity: 675,
    overview: "A grieving photographer becomes convinced her new neighbour is the man who ruined her life — and starts documenting his every move.",
    runtime: 112, genres: ["Thriller", "Drama"],
  },
  {
    id: 1083381, title: "Backrooms", year: 2026,
    posterPath: "/rhGx6E3qRNMgj3i5su2oukNHwIQ.jpg",
    theatricalDate: "2026-05-22",
    digital: { US: "2026-07-14", BG: "2026-07-14", GB: "2026-07-14", DE: null },
    providers: [ATV_R, GP_R], popularity: 450,
    overview: "Found-footage horror: a film crew maps an endless maze of fluorescent-lit office corridors that shouldn't exist.",
    runtime: 97, genres: ["Horror"],
  },
  {
    id: 1314481, title: "The Devil Wears Prada 2", year: 2026,
    posterPath: "/fCAURTUx3YfsJ8k9I0UamjSILiR.jpg",
    theatricalDate: "2026-05-01",
    digital: { US: "2026-06-30", BG: "2026-07-21", GB: "2026-07-02", DE: "2026-07-02" },
    providers: [DIS, ATV_B], popularity: 247,
  },
  {
    id: 1280738, title: "The Furious", year: 2026,
    posterPath: "/zP19YO60jwEsfKd5Qf1UvA5uJu8.jpg",
    theatricalDate: "2026-04-24",
    digital: { US: "2026-07-07", BG: "2026-07-07", GB: "2026-07-07", DE: "2026-07-07" },
    providers: [PRIME, ATV_R], popularity: 261,
  },
  {
    id: 1413976, title: "Citizen Vigilante", year: 2026,
    posterPath: "/6LmJD3Wohe0g4U62wgi7RyJqfE4.jpg",
    theatricalDate: "2026-04-10",
    digital: { US: "2026-06-19", BG: "2026-06-26", GB: "2026-06-19", DE: "2026-06-26" },
    providers: [MAX, GP_R], popularity: 185,
  },
  {
    id: 1127384, title: "Deep Water", year: 2026,
    posterPath: "/kjcuS7xaRyqRjVaVcH4t0qHshuX.jpg",
    theatricalDate: "2026-03-27",
    digital: { US: "2026-06-16", BG: "2026-06-16", GB: "2026-06-18", DE: "2026-06-16" },
    providers: [NF], popularity: 177,
  },
  {
    id: 1321008, title: "Black Box", year: 2026,
    posterPath: "/O7vJPEWsnLrKqPYHIHKG8zlEK1.jpg",
    theatricalDate: "2026-05-15",
    digital: { US: "2026-07-07", BG: null, GB: "2026-07-09", DE: "2026-07-09" },
    providers: [ATV_R, GP_R], popularity: 104,
  },
  // ---- upcoming (per-region dates after 2026-07-16) ----
  {
    id: 1275779, title: "Disclosure Day", year: 2026,
    posterPath: "/AnJ8IQJI23hNpYXVNaythu061Ru.jpg",
    theatricalDate: "2026-05-29",
    digital: { US: "2026-07-21", BG: "2026-07-28", GB: "2026-07-21", DE: "2026-07-28" },
    providers: [NF], popularity: 499,
  },
  {
    id: 1273221, title: "Scary Movie", year: 2026,
    posterPath: "/1KlYdWoOrbL5ux357rW9LC155qw.jpg",
    theatricalDate: "2026-06-12",
    digital: { US: "2026-07-21", BG: "2026-07-21", GB: "2026-07-23", DE: null },
    providers: [PRIME, ATV_B], popularity: 368,
  },
  {
    id: 980431, title: "Avatar Aang: The Last Airbender", year: 2026,
    posterPath: "/3sgnSfNT27Bx5O5ukr7B26mhEQq.jpg",
    theatricalDate: "2026-06-05",
    digital: { US: "2026-07-25", BG: "2026-08-01", GB: "2026-07-25", DE: "2026-08-01" },
    providers: [PRIME], popularity: 111,
  },
  {
    id: 1311031, title: "Demon Slayer: Infinity Castle", year: 2026,
    posterPath: "/fWVSwgjpT2D78VUh6X8UBd2rorW.jpg",
    theatricalDate: "2026-06-19",
    digital: { US: "2026-07-28", BG: "2026-08-11", GB: "2026-07-30", DE: "2026-08-11" },
    providers: [ATV_B, GP_R], popularity: 90,
  },
  {
    id: 1228710, title: "The Mandalorian and Grogu", year: 2026,
    posterPath: "/5Vi8dSauVwH1HOsiZceDMbRr1Ca.jpg",
    theatricalDate: "2026-05-22",
    digital: { US: "2026-07-21", BG: "2026-08-04", GB: "2026-07-21", DE: "2026-08-04" },
    providers: [DIS], popularity: 89,
  },
  {
    id: 454639, title: "Masters of the Universe", year: 2026,
    posterPath: "/3YMd9Ogae4rDKLWuAZFuse9xhc5.jpg",
    theatricalDate: "2026-06-06",
    digital: { US: "2026-08-04", BG: "2026-08-18", GB: "2026-08-06", DE: "2026-08-18" },
    providers: [NF, ATV_R], popularity: 37,
  },
  {
    // Out now in the US since May but still UPCOMING in BG — the movie that
    // makes region switching visibly re-bucket.
    id: 687163, title: "Project Hail Mary", year: 2026,
    posterPath: "/yihdXomYb5kTeSivtFndMy5iDmf.jpg",
    theatricalDate: "2026-03-20",
    digital: { US: "2026-05-12", BG: "2026-07-22", GB: "2026-05-14", DE: "2026-07-22" },
    providers: [MAX, ATV_B], popularity: 164,
    overview: "A lone astronaut wakes up light-years from home with no memory and one job: save two species from extinction.",
    runtime: 138, genres: ["Sci-Fi", "Adventure"],
  },
];

export interface RadarBuckets {
  recent: RadarMovie[];   // digital[region] <= TODAY, newest first
  upcoming: RadarMovie[]; // digital[region] > TODAY, soonest first
}

export function bucketFor(region: Region): RadarBuckets {
  const recent: RadarMovie[] = [];
  const upcoming: RadarMovie[] = [];
  for (const m of RADAR_MOVIES) {
    const d = m.digital[region];
    if (!d) continue;
    (d <= TODAY ? recent : upcoming).push(m);
  }
  recent.sort((a, b) => b.digital[region]!.localeCompare(a.digital[region]!) || b.popularity - a.popularity);
  upcoming.sort((a, b) => a.digital[region]!.localeCompare(b.digital[region]!) || b.popularity - a.popularity);
  return { recent, upcoming };
}

/** "18 Apr" / "18 Apr 2026" — local copies so the prototype stays detached. */
export function fmtShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function fmtFull(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function daysUntil(iso: string): number {
  return Math.round((+new Date(`${iso}T00:00:00`) - +new Date(`${TODAY}T00:00:00`)) / 86400000);
}

export const KIND_CLASS: Record<RadarProvider["kind"], string> = {
  stream: "badge-primary badge-outline",
  rent: "badge-secondary badge-outline",
  buy: "badge-accent badge-outline",
};

export const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
