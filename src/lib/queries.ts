import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toProvidersBG, type List, type Movie } from "./dashboard";

/** The lists that drive the switcher, ordered by their configured position. */
export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: async (): Promise<List[]> => {
      const { data, error } = await supabase
        .from("lists")
        .select("id, name, kind, position")
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// The nested shape supabase-js returns for the membership → movie → providers embed.
interface MembershipRow {
  movie: {
    id: number;
    imdb_id: string | null;
    tmdb_id: number | null;
    title: string | null;
    year: number | null;
    poster_path: string | null;
    theatrical_date: string | null;
    theatrical_region: string | null;
    digital_date: string | null;
    digital_region: string | null;
    watch_providers: {
      region: string;
      provider_name: string;
      offer_type: string;
      display_priority: number | null;
    }[];
  } | null;
}

/**
 * The active movies on one list: members with `on_list` true, each with its
 * effective dates and BG where-to-watch providers, in a single embedded read.
 * Enabled only once a list is chosen.
 */
export function useListMovies(listId: number | undefined) {
  return useQuery({
    queryKey: ["list-movies", listId],
    enabled: listId != null,
    queryFn: async (): Promise<Movie[]> => {
      const { data, error } = await supabase
        .from("list_memberships")
        .select(
          `movie:movies!inner(
            id, imdb_id, tmdb_id, title, year, poster_path,
            theatrical_date, theatrical_region, digital_date, digital_region,
            watch_providers(region, provider_name, offer_type, display_priority)
          )`,
        )
        .eq("list_id", listId!)
        .eq("on_list", true);
      if (error) throw error;

      const rows = (data ?? []) as unknown as MembershipRow[];
      return rows
        .map((r) => r.movie)
        .filter((m): m is NonNullable<MembershipRow["movie"]> => m != null)
        .map((m) => ({
          id: m.id,
          imdbId: m.imdb_id,
          tmdbId: m.tmdb_id,
          title: m.title,
          year: m.year,
          posterPath: m.poster_path,
          theatricalDate: m.theatrical_date,
          theatricalRegion: m.theatrical_region,
          digitalDate: m.digital_date,
          digitalRegion: m.digital_region,
          providersBG: toProvidersBG(m.watch_providers),
        }));
    },
  });
}
