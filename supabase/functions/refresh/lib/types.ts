export type Medium = "theatrical" | "digital";

export interface RawDate {
  region: string;
  medium: Medium;
  date: string; // YYYY-MM-DD
}

export interface Effective {
  date: string; // YYYY-MM-DD
  region: string;
}

export interface WatchlistItem {
  imdbId: string;
  title: string;
  year: number | null;
}

export interface DiscoverItem {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
}

export interface ProviderRow {
  region: string;
  providerId: number;
  offerType: "flatrate" | "free" | "ads" | "rent" | "buy";
  providerName: string;
  logoPath: string | null;
  displayPriority: number | null;
  link: string | null;
}

export interface MovieBundle {
  title: string | null;
  year: number | null;
  posterPath: string | null;
  imdbId: string | null;
  /** Synopsis from the same bundle call — feeds the detail panel (SPEC §10). */
  overview: string | null;
  /** Genre names from the same bundle call (SPEC §6, zero extra HTTP). */
  genres: string[];
  /** TMDB's own rating (0–10), vote count, and popularity score. */
  tmdbRating: number | null;
  tmdbVotes: number | null;
  popularity: number | null;
  /** YouTube key of the movie's trailer, or null — rides append_to_response=videos. */
  trailerKey: string | null;
  rawDates: RawDate[];
  providers: ProviderRow[];
}
