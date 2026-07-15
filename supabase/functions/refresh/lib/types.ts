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
  rawDates: RawDate[];
  providers: ProviderRow[];
}
