import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { type RawProvider, toProviders, toProvidersBG, type List, type Movie } from "./dashboard";
import type { ActiveMovie, LogEntry } from "./rail";
import type { RefreshRun, RefreshSummary, Settings, PushDevice } from "./settings";
import { subscribeThisDevice } from "./push";

interface ListRow {
  id: number;
  name: string;
  kind: string;
  position: number;
  sync_enabled: boolean;
  notifications_enabled: boolean;
  config: Record<string, unknown>;
}

/** The lists that drive the switcher and settings, ordered by position
 * (signed-in only — lists are RLS-scoped to the owner). */
export function useLists(enabled = true) {
  return useQuery({
    queryKey: ["lists"],
    enabled,
    queryFn: async (): Promise<List[]> => {
      const { data, error } = await supabase
        .from("lists")
        .select(
          "id, name, kind, position, sync_enabled, notifications_enabled, config",
        )
        .order("position");
      if (error) throw error;
      return ((data ?? []) as ListRow[]).map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind,
        position: l.position,
        syncEnabled: l.sync_enabled,
        notificationsEnabled: l.notifications_enabled,
        config: l.config ?? {},
      }));
    },
  });
}

// The nested shape supabase-js returns for the membership → movie → providers embed.
interface MembershipRow {
  added_at: string | null;
  movie: {
    id: number;
    imdb_id: string | null;
    tmdb_id: number | null;
    title: string | null;
    year: number | null;
    poster_path: string | null;
    genres: string[] | null;
    imdb_rating: number | null;
    imdb_votes: number | null;
    tmdb_rating: number | null;
    tmdb_votes: number | null;
    popularity: number | null;
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
          `added_at, movie:movies!inner(
            id, imdb_id, tmdb_id, title, year, poster_path, genres, imdb_rating, imdb_votes, tmdb_rating, tmdb_votes, popularity,
            theatrical_date, theatrical_region, digital_date, digital_region,
            watch_providers(region, provider_name, offer_type, display_priority)
          )`,
        )
        .eq("list_id", listId!)
        .eq("on_list", true);
      if (error) throw error;

      const rows = (data ?? []) as unknown as MembershipRow[];
      return rows
        .filter((r): r is MembershipRow & { movie: NonNullable<MembershipRow["movie"]> } => r.movie != null)
        .map((r) => {
          const m = r.movie;
          return {
            id: m.id,
            imdbId: m.imdb_id,
            tmdbId: m.tmdb_id,
            title: m.title,
            year: m.year,
            posterPath: m.poster_path,
            genres: m.genres ?? [],
            imdbRating: m.imdb_rating, imdbVotes: m.imdb_votes, tmdbRating: m.tmdb_rating, tmdbVotes: m.tmdb_votes,
            popularity: m.popularity, addedAt: r.added_at,
            theatricalDate: m.theatrical_date,
            theatricalRegion: m.theatrical_region,
            digitalDate: m.digital_date,
            digitalRegion: m.digital_region,
            providersBG: toProvidersBG(m.watch_providers),
          };
        });
    },
  });
}

// ---- Onboarding & account (SPEC §3) -----------------------------------

/** The caller's profile — role + whether they've finished onboarding. */
export function useProfile(enabled = true) {
  return useQuery({
    queryKey: ["profile"],
    enabled,
    queryFn: async (): Promise<{ role: string; onboarded: boolean } | null> => {
      const { data, error } = await supabase.from("profiles").select("role, onboarded").maybeSingle();
      if (error) throw error;
      return data ? { role: data.role, onboarded: data.onboarded } : null;
    },
  });
}

/** Complete onboarding via the edge function (settings + optional watchlist list
 * + onboarded flag); refetch everything so the Console reflects the new state. */
export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { regionCascade: string[]; timezone: string; imdbUserId: string | null }) => {
      const { data, error } = await supabase.functions.invoke("onboard", { body: input });
      if (error) throw error;
      const p = data as { error?: string } | null;
      if (p?.error) throw new Error(p.error);
      return p;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Connect / change the IMDb watchlist from anywhere (not just settings). */
export function useSetWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.functions.invoke("set-watchlist", { body: { url } });
      if (error) throw error;
      const p = data as { error?: string; imdbUserId?: string } | null;
      if (p?.error) throw new Error(p.error);
      return p;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

/** Self-serve account deletion via the edge function; the caller signs out after. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
      if (error) throw error;
      const p = data as { error?: string } | null;
      if (p?.error) throw new Error(p.error);
    },
  });
}

// ---- Digital Release Radar (SPEC §4) ----------------------------------

/** The curated supported regions for the navbar region select (anon-readable). */
export function useSupportedRegions() {
  return useQuery({
    queryKey: ["supported-regions"],
    queryFn: async (): Promise<{ region: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("supported_regions")
        .select("region, name")
        .order("position");
      if (error) throw error;
      return (data ?? []) as { region: string; name: string }[];
    },
    staleTime: Infinity,
  });
}

interface RadarRow {
  rank: number;
  movie: MembershipRow["movie"];
}

/**
 * The Digital Release Radar for one region × window (SPEC §4): the cron-computed
 * `radar_entries` joined to their movies, provider chips resolved for the chosen
 * region. Global tables, anon-readable — no auth, no browser TMDb calls.
 */
export function useRadar(region: string, window: "recent" | "upcoming") {
  return useQuery({
    queryKey: ["radar", region, window],
    enabled: !!region,
    queryFn: async (): Promise<Movie[]> => {
      const { data, error } = await supabase
        .from("radar_entries")
        .select(
          `rank, movie:movies!inner(
            id, imdb_id, tmdb_id, title, year, poster_path, genres, imdb_rating, imdb_votes, tmdb_rating, tmdb_votes, popularity,
            theatrical_date, theatrical_region, digital_date, digital_region,
            watch_providers(region, provider_name, offer_type, display_priority)
          )`,
        )
        .eq("region", region)
        .eq("window", window)
        .order("rank");
      if (error) throw error;
      const rows = (data ?? []) as unknown as RadarRow[];
      return rows
        .map((r) => r.movie)
        .filter((m): m is NonNullable<RadarRow["movie"]> => m != null)
        .map((m) => ({
          id: m.id,
          imdbId: m.imdb_id,
          tmdbId: m.tmdb_id,
          title: m.title,
          year: m.year,
          posterPath: m.poster_path,
          genres: m.genres ?? [],
          imdbRating: m.imdb_rating, imdbVotes: m.imdb_votes, tmdbRating: m.tmdb_rating, tmdbVotes: m.tmdb_votes,
          popularity: m.popularity, addedAt: null,
          theatricalDate: m.theatrical_date,
          theatricalRegion: m.theatrical_region,
          digitalDate: m.digital_date,
          digitalRegion: m.digital_region,
          providersBG: toProviders(m.watch_providers, region),
        }));
    },
  });
}

// ---- Search & follow (SPEC §11) ---------------------------------------

export interface SearchHit {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  /** On the caller's manual Followed list — toggleable in the dropdown. */
  followed: boolean;
  /** On the caller's IMDb watchlist — shown as a status, not a toggle. */
  onWatchlist: boolean;
  digitalDate: string | null;
}

/** TMDb search via the `search` edge function (bearer stays server-side). A
 * query (not a mutation) keyed on the term, so a follow/unfollow anywhere
 * invalidates it and the dropdown's Follow/Following state stays truthful. */
export function useSearch(term: string, enabled: boolean) {
  const q = term.trim();
  return useQuery({
    queryKey: ["search", q],
    enabled: enabled && q.length >= 2,
    queryFn: async (): Promise<SearchHit[]> => {
      const { data, error } = await supabase.functions.invoke("search", { body: { q } });
      if (error) throw error;
      const payload = data as { results?: SearchHit[]; error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      return payload?.results ?? [];
    },
  });
}

/** Follow / unfollow a movie via the `follow` edge function; refetch everything
 * so the Followed list, table, and detail panel reflect the change. */
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tmdbId, action }: { tmdbId: number; action: "follow" | "unfollow" }) => {
      const { data, error } = await supabase.functions.invoke("follow", { body: { tmdbId, action } });
      if (error) throw error;
      const payload = data as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      return payload;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** The movie ids the user currently follows (their manual Followed list) — RLS
 * scopes to the caller, so this drives the panel's Follow/Unfollow state. */
export function useFollowedIds(enabled = true) {
  return useQuery({
    queryKey: ["followed-ids"],
    enabled,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await supabase
        .from("list_memberships")
        .select("movie_id, lists!inner(kind)")
        .eq("on_list", true)
        .eq("lists.kind", "manual");
      if (error) throw error;
      return ((data ?? []) as unknown as { movie_id: number }[]).map((r) => r.movie_id);
    },
  });
}

export interface MovieDetail {
  id: number;
  title: string | null;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  trailerKey: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  releaseDates: { region: string; medium: "theatrical" | "digital"; releaseDate: string }[];
  rawProviders: RawProvider[];
}

interface MovieDetailRow {
  id: number;
  title: string | null;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  trailer_key: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  release_dates: { region: string; medium: "theatrical" | "digital"; release_date: string }[];
  watch_providers: RawProvider[];
}

/**
 * One movie's full detail for the side panel (SPEC §10): synopsis, trailer key,
 * every region's raw release dates (the cross-region matrix), and providers for
 * all regions. Global tables — anon-readable — so this works signed out too.
 */
export function useMovieDetail(movieId: number | null) {
  return useQuery({
    queryKey: ["movie-detail", movieId],
    enabled: movieId != null,
    queryFn: async (): Promise<MovieDetail> => {
      const { data, error } = await supabase
        .from("movies")
        .select(
          `id, title, year, poster_path, overview, trailer_key, tmdb_id, imdb_id,
           release_dates(region, medium, release_date),
           watch_providers(region, provider_name, offer_type, display_priority)`,
        )
        .eq("id", movieId!)
        .single();
      if (error) throw error;
      const m = data as unknown as MovieDetailRow;
      return {
        id: m.id,
        title: m.title,
        year: m.year,
        posterPath: m.poster_path,
        overview: m.overview,
        trailerKey: m.trailer_key,
        tmdbId: m.tmdb_id,
        imdbId: m.imdb_id,
        releaseDates: (m.release_dates ?? []).map((r) => ({
          region: r.region,
          medium: r.medium,
          releaseDate: r.release_date,
        })),
        rawProviders: m.watch_providers ?? [],
      };
    },
  });
}

// A movie plus its at-least-one on_list membership (inner join), for the rail.
interface ActiveMovieRow {
  id: number;
  title: string | null;
  theatrical_date: string | null;
  theatrical_region: string | null;
  digital_date: string | null;
  digital_region: string | null;
}

/**
 * Every active movie — on at least one list — regardless of the switcher.
 * The Upcoming timeline spans all lists, so it reads this rather than the
 * per-list movies.
 */
export function useActiveMovies() {
  return useQuery({
    queryKey: ["active-movies"],
    queryFn: async (): Promise<ActiveMovie[]> => {
      const { data, error } = await supabase
        .from("movies")
        .select(
          `id, title, theatrical_date, theatrical_region,
           digital_date, digital_region, list_memberships!inner(on_list)`,
        )
        .eq("list_memberships.on_list", true);
      if (error) throw error;
      const rows = (data ?? []) as unknown as ActiveMovieRow[];
      return rows.map((m) => ({
        id: m.id,
        title: m.title,
        theatricalDate: m.theatrical_date,
        theatricalRegion: m.theatrical_region,
        digitalDate: m.digital_date,
        digitalRegion: m.digital_region,
      }));
    },
  });
}

interface DeliveryRow {
  sent_at: string;
  channel: "push" | "email";
  event: {
    id: number;
    event: string;
    medium: string;
    effective_date: string;
    movie: { title: string | null } | null;
  } | null;
}

/**
 * The visible notification history: the user's own deliveries (RLS-scoped),
 * each joined to its global movie event. Seeded events are never delivered,
 * so they stay hidden by construction. Newest first.
 */
export function useNotificationLog() {
  return useQuery({
    queryKey: ["notification-log"],
    queryFn: async (): Promise<LogEntry[]> => {
      const { data, error } = await supabase
        .from("notification_deliveries")
        .select(
          "sent_at, channel, event:movie_events(id, event, medium, effective_date, movie:movies(title))",
        )
        .order("sent_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as DeliveryRow[];
      return rows
        .filter((r): r is DeliveryRow & { event: NonNullable<DeliveryRow["event"]> } =>
          r.event != null,
        )
        .map((r) => ({
          id: r.event.id,
          channel: r.channel,
          event: r.event.event as LogEntry["event"],
          medium: r.event.medium as LogEntry["medium"],
          effectiveDate: r.event.effective_date,
          sentAt: r.sent_at,
          movieTitle: r.event.movie?.title ?? "Untitled",
        }));
    },
  });
}

// ---- Settings + run controls -------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase
        .from("settings")
        .select("region_cascade, notify_email, notifications_paused, notify_hour")
        .single();
      if (error) throw error;
      return {
        regionCascade: data.region_cascade,
        notifyEmail: data.notify_email,
        notificationsPaused: data.notifications_paused,
        notifyHour: data.notify_hour,
      };
    },
  });
}

/** The most recent run, for the navbar's last-run summary (signed-in only —
 * refresh_runs is not anon-readable). */
export function useLastRun(enabled = true) {
  return useQuery({
    queryKey: ["last-run"],
    enabled,
    queryFn: async (): Promise<RefreshRun | null> => {
      const { data, error } = await supabase
        .from("refresh_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        trigger: data.trigger,
        startedAt: data.started_at,
        finishedAt: data.finished_at,
        status: data.status,
        moviesTotal: data.movies_total,
        moviesMatched: data.movies_matched,
        eventsCreated: data.events_created,
        notificationsSent: data.notifications_sent,
        error: data.error,
      };
    },
  });
}

export function usePushDevices() {
  return useQuery({
    queryKey: ["push-devices"],
    queryFn: async (): Promise<PushDevice[]> => {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.id,
        endpoint: d.endpoint,
        createdAt: d.created_at,
      }));
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      region_cascade?: string[];
      notify_email?: string | null;
      notifications_paused?: boolean;
      notify_hour?: number;
    }) => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const { error } = await supabase
        .from("settings")
        .update(patch)
        .eq("user_id", userData.user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number;
      patch: {
        sync_enabled?: boolean;
        notifications_enabled?: boolean;
        config?: Record<string, unknown>;
      };
    }) => {
      const { error } = await supabase.from("lists").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useDeletePushDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-devices"] }),
  });
}

/** Subscribe the current device to web push and store it. */
export function useSubscribeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: subscribeThisDevice,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-devices"] }),
  });
}

/**
 * "Refresh now" — invoke the refresh Edge Function with the user's session
 * (role authenticated → a manual run that bypasses the gate hour). On success,
 * refetch everything so the table, rail, and last-run summary reflect the run.
 */
export function useRefreshNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RefreshSummary> => {
      const { data, error } = await supabase.functions.invoke("refresh", {
        method: "POST",
        body: {},
      });
      if (error) throw error;
      const payload = data as (RefreshSummary & { error?: string }) | null;
      if (payload?.error) throw new Error(String(payload.error));
      return payload as RefreshSummary;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
