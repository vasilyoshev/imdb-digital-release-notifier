import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toProvidersBG, type List, type Movie } from "./dashboard";
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

/** The lists that drive the switcher and settings, ordered by position. */
export function useLists() {
  return useQuery({
    queryKey: ["lists"],
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
  movie: {
    id: number;
    imdb_id: string | null;
    tmdb_id: number | null;
    title: string | null;
    year: number | null;
    poster_path: string | null;
    genres: string[] | null;
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
            id, imdb_id, tmdb_id, title, year, poster_path, genres,
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
          genres: m.genres ?? [],
          theatricalDate: m.theatrical_date,
          theatricalRegion: m.theatrical_region,
          digitalDate: m.digital_date,
          digitalRegion: m.digital_region,
          providersBG: toProvidersBG(m.watch_providers),
        }));
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
          "sent_at, event:movie_events(id, event, medium, effective_date, movie:movies(title))",
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

/** The most recent run, for the navbar's last-run summary. */
export function useLastRun() {
  return useQuery({
    queryKey: ["last-run"],
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
