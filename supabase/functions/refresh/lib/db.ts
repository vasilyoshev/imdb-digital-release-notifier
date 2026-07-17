import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ProviderRow, RawDate } from "./types.ts";
import type { MediumLogState } from "./events.ts";
import type { RadarWindow } from "./radar.ts";

export interface Settings {
  user_id: string;
  region_cascade: string[];
  timezone: string;
  notify_email: string | null;
  notifications_paused: boolean;
  notify_hour: number;
}

export interface ListRow {
  id: number;
  user_id: string;
  kind: "imdb_watchlist" | "manual";
  name: string;
  sync_enabled: boolean;
  notifications_enabled: boolean;
  config: Record<string, unknown>;
}

export interface MovieRow {
  id: number;
  imdb_id: string | null;
  tmdb_id: number | null;
  title: string | null;
  year: number | null;
  poster_path: string | null;
  first_refreshed_at: string | null;
  refreshed_at: string | null;
}

/** One membership row joined to its owning list — the unit both the active-set
 * computation and per-user delivery gating are built from. */
export interface MembershipRow {
  movie_id: number;
  on_list: boolean;
  added_at: string;
  list_id: number;
  user_id: string;
  notifications_enabled: boolean;
}

const MOVIE_COLS = "id, imdb_id, tmdb_id, title, year, poster_path, first_refreshed_at, refreshed_at";

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`db ${what}: ${res.error.message}`);
  return res.data!;
}

export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** The owner's auth.users id — the single profiles row with role 'owner'. */
export async function getOwnerId(db: SupabaseClient): Promise<string> {
  const row = unwrap<{ user_id: string }>(
    await db.from("profiles").select("user_id").eq("role", "owner").single(),
    "getOwnerId",
  );
  return row.user_id;
}

/** Curated supported regions (SPEC §4), in cascade-priority position order. */
export async function getSupportedRegions(db: SupabaseClient): Promise<string[]> {
  const rows = unwrap<{ region: string }[]>(
    await db.from("supported_regions").select("region").order("position"),
    "getSupportedRegions",
  );
  return rows.map((r) => r.region);
}

export async function getSettings(db: SupabaseClient, userId: string): Promise<Settings> {
  return unwrap(
    await db.from("settings").select("*").eq("user_id", userId).single(),
    "getSettings",
  );
}

/** Every user's settings — drives the global cascade and per-user delivery. */
export async function getAllSettings(db: SupabaseClient): Promise<Settings[]> {
  return unwrap(await db.from("settings").select("*"), "getAllSettings");
}

/** Every user's lists (SPEC §8 job 1 syncs all sync-enabled lists of all users). */
export async function getAllLists(db: SupabaseClient): Promise<ListRow[]> {
  return unwrap(
    await db.from("lists").select("id, user_id, kind, name, sync_enabled, notifications_enabled, config")
      .order("position"),
    "getAllLists",
  );
}

/** All memberships joined to their list's owner + notifications flag. */
export async function getAllMemberships(db: SupabaseClient): Promise<MembershipRow[]> {
  const rows = unwrap<
    {
      movie_id: number;
      on_list: boolean;
      added_at: string;
      list_id: number;
      lists: { user_id: string; notifications_enabled: boolean } | null;
    }[]
  >(
    await db.from("list_memberships")
      .select("movie_id, on_list, added_at, list_id, lists!inner(user_id, notifications_enabled)"),
    "getAllMemberships",
  );
  return rows.map((r) => ({
    movie_id: r.movie_id,
    on_list: r.on_list,
    added_at: r.added_at,
    list_id: r.list_id,
    user_id: r.lists!.user_id,
    notifications_enabled: r.lists!.notifications_enabled,
  }));
}

export async function openRun(
  db: SupabaseClient,
  trigger: "cron" | "manual",
  job: "full" | "tick" | "delivery" | "user_refresh",
  userId: string | null = null,
): Promise<number> {
  const row = unwrap<{ id: number }>(
    await db.from("refresh_runs").insert({ trigger, job, user_id: userId }).select("id").single(),
    "openRun",
  );
  return row.id;
}

export async function closeRun(
  db: SupabaseClient,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  unwrap(
    await db.from("refresh_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id),
    "closeRun",
  );
}

/** When this user last ran a Refresh-now — the rate-limit clock (SPEC §8). */
export async function getLastUserRefreshAt(db: SupabaseClient, userId: string): Promise<string | null> {
  const rows = unwrap<{ started_at: string }[]>(
    await db.from("refresh_runs").select("started_at")
      .eq("job", "user_refresh").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(1),
    "getLastUserRefreshAt",
  );
  return rows[0]?.started_at ?? null;
}

export async function getAllMovies(db: SupabaseClient): Promise<MovieRow[]> {
  return unwrap(await db.from("movies").select(MOVIE_COLS), "getAllMovies");
}

export async function insertMovie(db: SupabaseClient, fields: Partial<MovieRow>): Promise<MovieRow> {
  return unwrap(
    await db.from("movies").insert(fields).select(MOVIE_COLS).single(),
    "insertMovie",
  );
}

export async function updateMovie(
  db: SupabaseClient,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  unwrap(await db.from("movies").update(patch).eq("id", id), "updateMovie");
}

export async function markFirstRefreshed(db: SupabaseClient, movieIds: number[]): Promise<void> {
  if (!movieIds.length) return;
  unwrap(
    await db.from("movies").update({ first_refreshed_at: new Date().toISOString() })
      .in("id", movieIds).is("first_refreshed_at", null),
    "markFirstRefreshed",
  );
}

export async function mergeMovies(db: SupabaseClient, stubId: number, canonicalId: number): Promise<void> {
  const stubMemberships = unwrap(
    await db.from("list_memberships").select("list_id, on_list").eq("movie_id", stubId),
    "mergeMovies.read",
  );
  const canonMemberships = unwrap(
    await db.from("list_memberships").select("list_id").eq("movie_id", canonicalId),
    "mergeMovies.readCanon",
  );
  const canonLists = new Set(canonMemberships.map((m: { list_id: number }) => m.list_id));
  for (const m of stubMemberships) {
    if (!canonLists.has(m.list_id)) {
      unwrap(
        await db.from("list_memberships").update({ movie_id: canonicalId })
          .eq("movie_id", stubId).eq("list_id", m.list_id),
        "mergeMovies.repoint",
      );
    }
  }
  unwrap(await db.from("list_memberships").delete().eq("movie_id", stubId), "mergeMovies.cleanup");
  unwrap(await db.from("movies").delete().eq("id", stubId), "mergeMovies.deleteStub");
}

export async function getMemberships(
  db: SupabaseClient,
  listId: number,
): Promise<{ movie_id: number; on_list: boolean }[]> {
  return unwrap(
    await db.from("list_memberships").select("movie_id, on_list").eq("list_id", listId),
    "getMemberships",
  );
}

export async function upsertMembership(
  db: SupabaseClient,
  listId: number,
  movieId: number,
  onList: boolean,
): Promise<void> {
  unwrap(
    await db.from("list_memberships").upsert({
      list_id: listId,
      movie_id: movieId,
      on_list: onList,
      removed_at: onList ? null : new Date().toISOString(),
    }, { onConflict: "list_id,movie_id" }),
    "upsertMembership",
  );
}

export async function replaceReleaseDates(
  db: SupabaseClient,
  movieId: number,
  rows: RawDate[],
): Promise<void> {
  unwrap(await db.from("release_dates").delete().eq("movie_id", movieId), "replaceReleaseDates.delete");
  if (rows.length) {
    unwrap(
      await db.from("release_dates").insert(
        rows.map((r) => ({ movie_id: movieId, region: r.region, medium: r.medium, release_date: r.date })),
      ),
      "replaceReleaseDates.insert",
    );
  }
}

export async function replaceProviders(
  db: SupabaseClient,
  movieId: number,
  rows: ProviderRow[],
): Promise<void> {
  unwrap(await db.from("watch_providers").delete().eq("movie_id", movieId), "replaceProviders.delete");
  if (rows.length) {
    unwrap(
      await db.from("watch_providers").insert(
        rows.map((r) => ({
          movie_id: movieId,
          region: r.region,
          provider_id: r.providerId,
          offer_type: r.offerType,
          provider_name: r.providerName,
          logo_path: r.logoPath,
          display_priority: r.displayPriority,
          link: r.link,
        })),
      ),
      "replaceProviders.insert",
    );
  }
}

/** Per-region digital release dates for a set of movies — the radar's
 * verify-before-write source (SPEC §4), read straight from `release_dates`. */
export async function getDigitalDatesForRegion(
  db: SupabaseClient,
  movieIds: number[],
  region: string,
): Promise<Map<number, string>> {
  if (!movieIds.length) return new Map();
  const rows = unwrap<{ movie_id: number; release_date: string }[]>(
    await db.from("release_dates").select("movie_id, release_date")
      .eq("region", region).eq("medium", "digital").in("movie_id", movieIds),
    "getDigitalDatesForRegion",
  );
  return new Map(rows.map((r) => [r.movie_id, r.release_date]));
}

/** Replace all radar_entries for one region × window (SPEC §4/§7). */
export async function replaceRadarEntries(
  db: SupabaseClient,
  region: string,
  window: string,
  rows: { region: string; window: RadarWindow; movie_id: number; rank: number; digital_date: string }[],
): Promise<void> {
  unwrap(
    await db.from("radar_entries").delete().eq("region", region).eq("window", window),
    "replaceRadarEntries.delete",
  );
  if (rows.length) {
    unwrap(
      await db.from("radar_entries").insert(
        rows.map((r) => ({ region: r.region, window: r.window, movie_id: r.movie_id, rank: r.rank, digital_date: r.digital_date })),
      ),
      "replaceRadarEntries.insert",
    );
  }
}

export async function getLogStates(db: SupabaseClient): Promise<Map<string, MediumLogState>> {
  const rows = unwrap(
    await db.from("movie_events")
      .select("movie_id, medium, event, effective_date, created_at")
      .order("created_at", { ascending: true }),
    "getLogStates",
  );
  const map = new Map<string, MediumLogState>();
  for (const r of rows) {
    const key = `${r.movie_id}:${r.medium}`;
    const state = map.get(key) ?? { announcedEver: false, releasedEver: false, lastLoggedDate: null };
    if (r.event === "announced") state.announcedEver = true;
    if (r.event === "released") state.releasedEver = true;
    state.lastLoggedDate = r.effective_date;
    map.set(key, state);
  }
  return map;
}

export async function insertEventRows(
  db: SupabaseClient,
  rows: { movie_id: number; medium: string; event: string; effective_date: string; seeded: boolean }[],
): Promise<{ id: number; movie_id: number; created_at: string }[]> {
  if (!rows.length) return [];
  return unwrap(
    await db.from("movie_events").insert(rows).select("id, movie_id, created_at"),
    "insertEventRows",
  );
}

/** Event ids already delivered to one user (any channel) — the delivery dedupe. */
export async function getDeliveredEventIds(db: SupabaseClient, userId: string): Promise<Set<number>> {
  const rows = unwrap<{ event_id: number }[]>(
    await db.from("notification_deliveries").select("event_id").eq("user_id", userId),
    "getDeliveredEventIds",
  );
  return new Set(rows.map((r) => r.event_id));
}

/** Non-seeded events on the given movies, oldest first, for delivery selection. */
export async function getDeliverableEvents(
  db: SupabaseClient,
  movieIds: number[],
): Promise<{ id: number; movie_id: number; medium: string; event: string; effective_date: string; created_at: string }[]> {
  if (!movieIds.length) return [];
  return unwrap(
    await db.from("movie_events")
      .select("id, movie_id, medium, event, effective_date, created_at")
      .in("movie_id", movieIds).eq("seeded", false).order("created_at", { ascending: true }),
    "getDeliverableEvents",
  );
}

export async function insertDeliveries(
  db: SupabaseClient,
  userId: string,
  eventIds: number[],
  channel: "push" | "email",
): Promise<void> {
  if (!eventIds.length) return;
  const sentAt = new Date().toISOString();
  unwrap(
    await db.from("notification_deliveries").upsert(
      eventIds.map((id) => ({ user_id: userId, event_id: id, channel, sent_at: sentAt })),
      { onConflict: "user_id,event_id,channel" },
    ),
    "insertDeliveries",
  );
}

/** One user's push subscriptions — never broadcast across tenants. */
export async function getSubscriptions(
  db: SupabaseClient,
  userId: string,
): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return unwrap(
    await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId),
    "getSubscriptions",
  );
}

export async function deleteSubscriptions(db: SupabaseClient, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return;
  unwrap(await db.from("push_subscriptions").delete().in("endpoint", endpoints), "deleteSubscriptions");
}
