import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ProviderRow, RawDate } from "./types.ts";
import type { MediumLogState } from "./events.ts";

export interface Settings {
  region_order: string[];
  notify_email: string | null;
  notifications_paused: boolean;
  notify_hour: number;
}

export interface ListRow {
  id: number;
  kind: "imdb_watchlist" | "tmdb_discover";
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
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`db ${what}: ${res.error.message}`);
  return res.data!;
}

export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getSettings(db: SupabaseClient): Promise<Settings> {
  return unwrap(await db.from("settings").select("*").single(), "getSettings");
}

export async function getLists(db: SupabaseClient): Promise<ListRow[]> {
  return unwrap(await db.from("lists").select("*").order("position"), "getLists");
}

export async function openRun(db: SupabaseClient, trigger: "cron" | "manual"): Promise<number> {
  const row = unwrap<{ id: number }>(
    await db.from("refresh_runs").insert({ trigger }).select("id").single(),
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

export async function getAllMovies(db: SupabaseClient): Promise<MovieRow[]> {
  return unwrap(
    await db.from("movies").select("id, imdb_id, tmdb_id, title, year, poster_path"),
    "getAllMovies",
  );
}

export async function insertMovie(db: SupabaseClient, fields: Partial<MovieRow>): Promise<MovieRow> {
  return unwrap(
    await db.from("movies").insert(fields).select("id, imdb_id, tmdb_id, title, year, poster_path").single(),
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

export async function getLogStates(db: SupabaseClient): Promise<Map<string, MediumLogState>> {
  const rows = unwrap(
    await db.from("notification_log")
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

export async function insertLogRows(
  db: SupabaseClient,
  rows: { movie_id: number; medium: string; event: string; effective_date: string; sent_at: string | null }[],
): Promise<number[]> {
  if (!rows.length) return [];
  const inserted = unwrap(
    await db.from("notification_log").insert(rows).select("id"),
    "insertLogRows",
  );
  return inserted.map((r: { id: number }) => r.id);
}

export async function markSent(db: SupabaseClient, ids: number[]): Promise<void> {
  if (!ids.length) return;
  unwrap(
    await db.from("notification_log").update({ sent_at: new Date().toISOString() }).in("id", ids),
    "markSent",
  );
}

export async function getSubscriptions(
  db: SupabaseClient,
): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return unwrap(await db.from("push_subscriptions").select("endpoint, p256dh, auth"), "getSubscriptions");
}

export async function deleteSubscriptions(db: SupabaseClient, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return;
  unwrap(await db.from("push_subscriptions").delete().in("endpoint", endpoints), "deleteSubscriptions");
}
