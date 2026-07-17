import {
  closeRun,
  deleteSubscriptions,
  getAllLists,
  getAllMemberships,
  getAllMovies,
  getAllSettings,
  getDeliverableEvents,
  getDeliveredEventIds,
  getDigitalDatesForRegion,
  getLogStates,
  getMemberships,
  getSubscriptions,
  getSupportedRegions,
  insertDeliveries,
  insertEventRows,
  insertMovie,
  markFirstRefreshed,
  type MembershipRow,
  mergeMovies,
  type MovieRow,
  openRun,
  replaceProviders,
  replaceRadarEntries,
  replaceReleaseDates,
  type Settings,
  updateMovie,
  upsertMembership,
} from "./db.ts";
import { fetchWatchlist } from "./imdb.ts";
import { fetchChanges, fetchDiscover, fetchMovieBundle, findTmdbId } from "./tmdb.ts";
import { buildGlobalCascade, computeEffective, dateInZone, hourInZone } from "./dates.ts";
import { detectMediumEvents, type MediumLogState } from "./events.ts";
import { selectDeliveries, selectForHydration } from "./pipeline.ts";
import { buildRadarRows, radarWindow, type RadarWindow } from "./radar.ts";
import { buildDigest, type DigestEvent, sendDigest } from "./email.ts";
import { type PushMessage, sendPushes } from "./push.ts";
import type { Medium } from "./types.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MEDIUMS: Medium[] = ["theatrical", "digital"];
const NO_STATE: MediumLogState = { announcedEver: false, releasedEver: false, lastLoggedDate: null };
// Per-run hydration cap (SPEC §8 quota guardrails). Config via env; 0 = no cap.
const HYDRATION_CAP = Number(Deno.env.get("HYDRATION_CAP") ?? "300");
// Politeness delay between per-user watchlist fetches (SPEC §5a "staggered").
const SYNC_STAGGER_MS = Number(Deno.env.get("SYNC_STAGGER_MS") ?? "1000");

// Radar config (SPEC §4). Its own smaller hydration cap so the radar and user
// syncs can't starve each other; both share the movies cache + refreshed_at.
const RADAR_HYDRATION_CAP = Number(Deno.env.get("RADAR_HYDRATION_CAP") ?? "120");
const RADAR_DISCOVER_LIMIT = Number(Deno.env.get("RADAR_DISCOVER_LIMIT") ?? "60");
const RADAR_RECENT_DAYS = Number(Deno.env.get("RADAR_RECENT_DAYS") ?? "45");
const RADAR_UPCOMING_DAYS = Number(Deno.env.get("RADAR_UPCOMING_DAYS") ?? "90");
const RADAR_FRESH_HOURS = Number(Deno.env.get("RADAR_FRESH_HOURS") ?? "20");
const RADAR_WINDOWS: RadarWindow[] = ["recent", "upcoming"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isFresh = (refreshedAt: string | null, now: number, ms: number) =>
  refreshedAt !== null && now - Date.parse(refreshedAt) < ms;

interface EventRow {
  movie_id: number;
  medium: string;
  event: string;
  effective_date: string;
  seeded: boolean;
}

/** Write one hydrated bundle onto its movie row — raw dates/providers, cached
 * metadata (genres, trailer), and the global-cascade effective dates. Mutates
 * the in-memory `movie` (refreshed_at, imdb backfill) so the shared cache stays
 * consistent within a run. Returns the effective date per medium for detection. */
async function applyBundle(
  db: SupabaseClient,
  movie: MovieRow,
  bundle: NonNullable<Awaited<ReturnType<typeof fetchMovieBundle>>>,
  globalCascade: string[],
  knownImdbIds: Set<string>,
): Promise<Record<Medium, string | null>> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    title: bundle.title ?? movie.title,
    year: bundle.year ?? movie.year,
    poster_path: bundle.posterPath ?? movie.poster_path,
    genres: bundle.genres,
    trailer_key: bundle.trailerKey,
    refreshed_at: nowIso,
  };
  if (bundle.imdbId && !movie.imdb_id && !knownImdbIds.has(bundle.imdbId)) {
    patch.imdb_id = bundle.imdbId;
    movie.imdb_id = bundle.imdbId;
    knownImdbIds.add(bundle.imdbId);
  }
  await replaceReleaseDates(db, movie.id, bundle.rawDates);
  await replaceProviders(db, movie.id, bundle.providers);

  const effByMedium = {} as Record<Medium, string | null>;
  for (const medium of MEDIUMS) {
    const eff = computeEffective(bundle.rawDates, globalCascade, medium);
    patch[`${medium}_date`] = eff?.date ?? null;
    patch[`${medium}_region`] = eff?.region ?? null;
    effByMedium[medium] = eff?.date ?? null;
  }
  await updateMovie(db, movie.id, patch);
  movie.refreshed_at = nowIso;
  return effByMedium;
}

/** Detection is global; hydrate one movie, replace its raw data, and detect the
 * events its new effective dates imply. Shared by the full run and the tick. */
async function hydrateAndDetect(
  db: SupabaseClient,
  movie: MovieRow,
  tmdbToken: string,
  regions: string[],
  globalCascade: string[],
  logStates: Map<string, MediumLogState>,
  today: string,
  knownImdbIds: Set<string>,
): Promise<{ ok: boolean; isNew: boolean; events: EventRow[] }> {
  let bundle;
  try {
    bundle = await fetchMovieBundle(movie.tmdb_id!, tmdbToken, fetch, regions);
  } catch (err) {
    // 429s are retried inside fetchMovieBundle; a hard failure defers the movie.
    console.error(`hydrate movie ${movie.id} (tmdb ${movie.tmdb_id}) failed:`, err);
    return { ok: false, isNew: false, events: [] };
  }
  if (!bundle) return { ok: false, isNew: false, events: [] };

  const isNew = movie.first_refreshed_at === null;
  const eff = await applyBundle(db, movie, bundle, globalCascade, knownImdbIds);

  const events: EventRow[] = [];
  for (const medium of MEDIUMS) {
    const state = logStates.get(`${movie.id}:${medium}`) ?? NO_STATE;
    for (const ev of detectMediumEvents({ currentEffective: eff[medium], state, isNewMovie: isNew, today })) {
      events.push({
        movie_id: movie.id,
        medium,
        event: ev.event,
        effective_date: ev.effectiveDate,
        seeded: ev.pastFactOnFirstObservation,
      });
    }
  }
  return { ok: true, isNew, events };
}

/** SPEC §4 — the Digital Release Radar's data side, folded into the daily full
 * run. Per supported region × window: discover digital releases in the window,
 * ensure/hydrate each (own cap; shared refreshed_at cache dedupes with user
 * syncs), then verify against the hydrated per-region digital date before
 * writing ranked radar_entries — discover's top-level date leaks. */
async function runRadar(
  db: SupabaseClient,
  tmdbToken: string,
  regions: string[],
  globalCascade: string[],
  byTmdb: Map<number, MovieRow>,
  knownImdbIds: Set<string>,
  today: string,
): Promise<{ regionsWithData: number; entries: number; hydrated: number }> {
  const freshMs = RADAR_FRESH_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  let hydrated = 0;
  let entries = 0;
  let regionsWithData = 0;

  for (const region of regions) {
    let regionEntries = 0;
    for (const window of RADAR_WINDOWS) {
      const range = radarWindow(today, window, RADAR_RECENT_DAYS, RADAR_UPCOMING_DAYS);
      const sort = window === "recent" ? "primary_release_date.desc" : "primary_release_date.asc";
      let candidates;
      try {
        candidates = await fetchDiscover({
          filters: {
            with_release_type: 4,
            region,
            "release_date.gte": range.gte,
            "release_date.lte": range.lte,
            sort_by: sort,
          },
          limit: RADAR_DISCOVER_LIMIT,
        }, tmdbToken);
      } catch (err) {
        console.error(`radar discover ${region}/${window} failed (isolated):`, err);
        continue;
      }

      const movieIds: number[] = [];
      for (const c of candidates) {
        let movie = byTmdb.get(c.tmdbId);
        if (!movie) {
          movie = await insertMovie(db, { tmdb_id: c.tmdbId, title: c.title, year: c.year, poster_path: c.posterPath });
          byTmdb.set(c.tmdbId, movie);
        }
        if (!isFresh(movie.refreshed_at, now, freshMs) && hydrated < RADAR_HYDRATION_CAP) {
          try {
            const bundle = await fetchMovieBundle(movie.tmdb_id!, tmdbToken, fetch, regions);
            if (bundle) {
              await applyBundle(db, movie, bundle, globalCascade, knownImdbIds);
              hydrated++;
            }
          } catch (err) {
            console.error(`radar hydrate movie ${movie.id} failed:`, err);
          }
        }
        movieIds.push(movie.id);
      }

      const digitalByMovie = await getDigitalDatesForRegion(db, movieIds, region);
      const rows = buildRadarRows(movieIds, region, window, range, digitalByMovie);
      await replaceRadarEntries(db, region, window, rows);
      entries += rows.length;
      regionEntries += rows.length;
    }
    if (regionEntries > 0) regionsWithData++;
  }
  return { regionsWithData, entries, hydrated };
}

/** SPEC §8 job 1 — the daily full refresh. Detection only; delivery is the
 * tick's owner shim today and the delivery slice (#56) tomorrow. */
export async function runFull(
  db: SupabaseClient,
  trigger: "cron" | "manual",
  tmdbToken: string,
  ownerId: string,
): Promise<Record<string, unknown>> {
  const runId = await openRun(db, trigger, "full");
  try {
    const regions = await getSupportedRegions(db);
    const settings = await getAllSettings(db);
    const globalCascade = buildGlobalCascade(settings.map((s) => s.region_cascade), regions);
    const today = dateInZone(ownerTimezone(settings, ownerId));

    // ---- 1. Sync every sync-enabled IMDb watchlist across all users, staggered,
    //         with per-list failure isolation (one broken list never kills the run).
    const lists = await getAllLists(db);
    let movies = await getAllMovies(db);
    const byImdb = new Map(movies.filter((m) => m.imdb_id).map((m) => [m.imdb_id!, m]));
    const syncFailures: number[] = [];
    let staggered = false;
    for (const list of lists) {
      if (list.kind !== "imdb_watchlist" || !list.sync_enabled) continue;
      if (staggered && SYNC_STAGGER_MS > 0) await sleep(SYNC_STAGGER_MS);
      staggered = true;
      try {
        const imdbUserId = String(list.config.imdb_user_id ?? "");
        if (!imdbUserId) throw new Error(`list ${list.id} (${list.name}) has no imdb_user_id`);
        const items = await fetchWatchlist(imdbUserId);
        const wanted = new Set<number>();
        for (const item of items) {
          let movie = byImdb.get(item.imdbId);
          if (!movie) {
            movie = await insertMovie(db, { imdb_id: item.imdbId, title: item.title, year: item.year });
            byImdb.set(item.imdbId, movie);
            movies.push(movie);
          }
          wanted.add(movie.id);
        }
        const existing = await getMemberships(db, list.id);
        for (const movieId of wanted) {
          const prev = existing.find((m) => m.movie_id === movieId);
          if (!prev || !prev.on_list) await upsertMembership(db, list.id, movieId, true);
        }
        for (const prev of existing) {
          if (prev.on_list && !wanted.has(prev.movie_id)) await upsertMembership(db, list.id, prev.movie_id, false);
        }
      } catch (err) {
        syncFailures.push(list.id);
        console.error(`list ${list.id} sync failed (isolated):`, err);
      }
    }

    // ---- 2. Active set = movies on_list anywhere (SPEC §7).
    const memberships = await getAllMemberships(db);
    const activeIds = new Set(memberships.filter((m) => m.on_list).map((m) => m.movie_id));

    // ---- 3. Resolve identities for active imdb-only movies (/find + merge rule).
    movies = await getAllMovies(db);
    const byTmdb = new Map(movies.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id!, m]));
    for (const movie of movies) {
      if (movie.tmdb_id || !movie.imdb_id || !activeIds.has(movie.id)) continue;
      const tmdbId = await findTmdbId(movie.imdb_id, tmdbToken);
      if (!tmdbId) continue; // stays Unmatched, retried next run
      const existing = byTmdb.get(tmdbId);
      if (existing && existing.id !== movie.id) {
        await mergeMovies(db, movie.id, existing.id);
        await updateMovie(db, existing.id, { imdb_id: movie.imdb_id });
        existing.imdb_id = movie.imdb_id;
        activeIds.delete(movie.id);
        activeIds.add(existing.id);
      } else {
        await updateMovie(db, movie.id, { tmdb_id: tmdbId });
        movie.tmdb_id = tmdbId;
        byTmdb.set(tmdbId, movie);
      }
    }

    // ---- 4. Hydrate the active+matched union once each, capped oldest-first.
    const all = await getAllMovies(db);
    const knownImdbIds = new Set(all.filter((m) => m.imdb_id).map((m) => m.imdb_id!));
    const activeMatched = all.filter((m) => activeIds.has(m.id) && m.tmdb_id);
    const plan = selectForHydration(activeMatched.map((m) => ({ id: m.id, refreshed_at: m.refreshed_at })), HYDRATION_CAP);
    const toHydrate = new Set(plan.toHydrate);
    const logStates = await getLogStates(db);

    let matched = 0;
    let fetchFailures = 0;
    const eventRows: EventRow[] = [];
    const refreshedNewMovieIds: number[] = [];
    for (const movie of activeMatched) {
      if (!toHydrate.has(movie.id)) continue;
      const res = await hydrateAndDetect(db, movie, tmdbToken, regions, globalCascade, logStates, today, knownImdbIds);
      if (!res.ok) {
        fetchFailures++;
        continue;
      }
      matched++;
      if (res.isNew) refreshedNewMovieIds.push(movie.id);
      eventRows.push(...res.events);
    }

    // ---- 5. Append events globally, then stamp first-refresh (after insert so a
    //         mid-run crash leaves the movie re-detectable).
    await insertEventRows(db, eventRows);
    await markFirstRefreshed(db, refreshedNewMovieIds);

    // ---- 6. Refresh the Digital Release Radar for every supported region. Reads
    //         the just-hydrated movie cache so shared movies aren't re-fetched.
    const afterHydrate = await getAllMovies(db);
    const radarByTmdb = new Map(afterHydrate.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id!, m]));
    const radarKnownImdb = new Set(afterHydrate.filter((m) => m.imdb_id).map((m) => m.imdb_id!));
    const radar = await runRadar(db, tmdbToken, regions, globalCascade, radarByTmdb, radarKnownImdb, today);

    const moviesDeferred = plan.deferred + fetchFailures;
    await closeRun(db, runId, {
      status: "success",
      movies_total: activeIds.size,
      movies_matched: matched,
      events_created: eventRows.length,
      notifications_sent: 0,
      movies_deferred: moviesDeferred,
    });
    return {
      runId,
      job: "full",
      moviesTotal: activeIds.size,
      moviesMatched: matched,
      eventsCreated: eventRows.length,
      moviesDeferred,
      syncFailures: syncFailures.length,
      radarRegions: radar.regionsWithData,
      radarEntries: radar.entries,
      radarHydrated: radar.hydrated,
    };
  } catch (err) {
    await closeRunSafe(db, runId, err);
    throw err;
  }
}

/** SPEC §8 job 2 — the hourly change tick, plus the transition owner-delivery
 * shim (removed when the delivery slice #56 generalizes delivery to all users). */
export async function runTick(
  db: SupabaseClient,
  trigger: "cron" | "manual",
  tmdbToken: string,
  ownerId: string,
): Promise<Record<string, unknown>> {
  const runId = await openRun(db, trigger, "tick");
  try {
    const regions = await getSupportedRegions(db);
    const settings = await getAllSettings(db);
    const ownerSettings = settings.find((s) => s.user_id === ownerId) ?? null;
    const ownerTZ = ownerSettings?.timezone ?? "UTC";
    const globalCascade = buildGlobalCascade(settings.map((s) => s.region_cascade), regions);
    const today = dateInZone(ownerTZ);

    // ---- 1. Re-hydrate tracked movies TMDb reports changed in the last day.
    const memberships = await getAllMemberships(db);
    const activeIds = new Set(memberships.filter((m) => m.on_list).map((m) => m.movie_id));
    const movies = await getAllMovies(db);
    const knownImdbIds = new Set(movies.filter((m) => m.imdb_id).map((m) => m.imdb_id!));
    const activeTmdb = movies.filter((m) => activeIds.has(m.id) && m.tmdb_id);
    const startDate = dateInZone(ownerTZ, new Date(Date.now() - 24 * 60 * 60 * 1000));
    const changed = new Set(await fetchChanges(startDate, tmdbToken));
    const toRefresh = activeTmdb.filter((m) => changed.has(m.tmdb_id!));

    const logStates = await getLogStates(db);
    let matched = 0;
    const eventRows: EventRow[] = [];
    const refreshedNewMovieIds: number[] = [];
    for (const movie of toRefresh) {
      const res = await hydrateAndDetect(db, movie, tmdbToken, regions, globalCascade, logStates, today, knownImdbIds);
      if (!res.ok) continue;
      matched++;
      if (res.isNew) refreshedNewMovieIds.push(movie.id);
      eventRows.push(...res.events);
    }
    await insertEventRows(db, eventRows);
    await markFirstRefreshed(db, refreshedNewMovieIds);

    // ---- 2. Transition shim: owner delivery at the owner's local gate hour.
    let notificationsSent = 0;
    if (ownerSettings && hourInZone(ownerTZ) === ownerSettings.notify_hour) {
      const movieById = new Map(movies.map((m) => [m.id, m]));
      notificationsSent = await deliverOwner(db, ownerId, ownerSettings, memberships, movieById);
    }

    await closeRun(db, runId, {
      status: "success",
      movies_total: toRefresh.length,
      movies_matched: matched,
      events_created: eventRows.length,
      notifications_sent: notificationsSent,
    });
    return {
      runId,
      job: "tick",
      moviesChanged: toRefresh.length,
      moviesMatched: matched,
      eventsCreated: eventRows.length,
      notificationsSent,
    };
  } catch (err) {
    await closeRunSafe(db, runId, err);
    throw err;
  }
}

/** Owner-only delivery (SPEC §9). Temporary: the delivery slice (#56) replaces
 * this with the per-timezone job that serves every user. */
async function deliverOwner(
  db: SupabaseClient,
  ownerId: string,
  ownerSettings: Settings,
  memberships: MembershipRow[],
  movieById: Map<number, MovieRow>,
): Promise<number> {
  // Movies the owner follows on a notifications-enabled list → earliest added_at.
  const followedSince = new Map<number, string>();
  for (const m of memberships) {
    if (m.user_id !== ownerId || !m.on_list || !m.notifications_enabled) continue;
    const prev = followedSince.get(m.movie_id);
    if (prev === undefined || m.added_at < prev) followedSince.set(m.movie_id, m.added_at);
  }
  const events = await getDeliverableEvents(db, [...followedSince.keys()]);
  const delivered = await getDeliveredEventIds(db, ownerId);
  const sendIds = new Set(
    selectDeliveries(
      events.map((e) => ({ id: e.id, movie_id: e.movie_id, created_at: e.created_at })),
      followedSince,
      delivered,
      ownerSettings.notifications_paused,
    ),
  );
  const toSend = events.filter((e) => sendIds.has(e.id));
  if (!toSend.length) return 0;

  const appUrl = Deno.env.get("APP_URL") ?? "/";
  const digestEvents: DigestEvent[] = toSend.map((e) => {
    const movie = movieById.get(e.movie_id);
    return {
      movieTitle: movie?.title ?? movie?.imdb_id ?? String(e.movie_id),
      year: movie?.year ?? null,
      medium: e.medium as Medium,
      event: e.event as DigestEvent["event"],
      effectiveDate: e.effective_date,
    };
  });

  // Email digest — owner only, honored only when configured.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailSent: number[] = [];
  if (resendKey && ownerSettings.notify_email) {
    try {
      const digest = buildDigest(digestEvents, appUrl);
      if (digest) {
        await sendDigest(resendKey, Deno.env.get("NOTIFY_FROM") ?? "onboarding@resend.dev", ownerSettings.notify_email, digest);
        emailSent.push(...toSend.map((e) => e.id));
      }
    } catch (err) {
      console.error("email digest failed:", err);
    }
  }

  // Web push — one notification per event.
  const vapid = Deno.env.get("VAPID_KEYS_JSON");
  const pushSent: number[] = [];
  if (vapid) {
    try {
      const subs = await getSubscriptions(db, ownerId);
      if (subs.length) {
        const messages: PushMessage[] = digestEvents.map((e) => ({
          title: e.event === "released"
            ? `${e.movieTitle} is out now (${e.medium})`
            : e.event === "announced"
            ? `${e.movieTitle}: ${e.medium} date announced`
            : `${e.movieTitle}: ${e.medium} date changed`,
          body: `${e.medium} — ${e.effectiveDate}`,
          url: appUrl,
        }));
        const result = await sendPushes(vapid, Deno.env.get("PUSH_CONTACT") ?? "mailto:vasil.yoshev@gmail.com", subs, messages);
        await deleteSubscriptions(db, result.staleEndpoints);
        pushSent.push(...toSend.map((e) => e.id));
      }
    } catch (err) {
      console.error("push delivery failed:", err);
    }
  }

  await insertDeliveries(db, ownerId, emailSent, "email");
  await insertDeliveries(db, ownerId, pushSent, "push");
  // An event counts as delivered if it went out on any channel.
  return new Set([...emailSent, ...pushSent]).size;
}

function ownerTimezone(settings: Settings[], ownerId: string): string {
  return settings.find((s) => s.user_id === ownerId)?.timezone ?? "UTC";
}

async function closeRunSafe(db: SupabaseClient, runId: number, err: unknown): Promise<void> {
  try {
    await closeRun(db, runId, { status: "error", error: String(err) });
  } catch (closeErr) {
    console.error("failed to close run:", closeErr);
  }
  console.error("refresh run failed:", err);
}
