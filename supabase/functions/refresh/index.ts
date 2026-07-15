import { closeRun, createServiceClient, deleteSubscriptions, getAllMovies, getLists, getLogStates, getMemberships, getSettings, getSubscriptions, insertLogRows, insertMovie, markFirstRefreshed, markSent, mergeMovies, openRun, replaceProviders, replaceReleaseDates, updateMovie, upsertMembership, type MovieRow } from "./lib/db.ts";
import { fetchWatchlist } from "./lib/imdb.ts";
import { fetchDiscover, fetchMovieBundle, findTmdbId, type DiscoverConfig } from "./lib/tmdb.ts";
import { computeEffective, sofiaHour, sofiaToday } from "./lib/dates.ts";
import { detectMediumEvents } from "./lib/events.ts";
import { buildDigest, sendDigest, type DigestEvent } from "./lib/email.ts";
import { sendPushes, type PushMessage } from "./lib/push.ts";
import { roleFromAuthHeader } from "./lib/auth.ts";
import type { Medium } from "./lib/types.ts";

const MEDIUMS: Medium[] = ["theatrical", "digital"];

Deno.serve(async (req: Request) => {
  const role = roleFromAuthHeader(req.headers.get("authorization"));
  if (role !== "service_role" && role !== "authenticated") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const trigger: "cron" | "manual" = role === "service_role" ? "cron" : "manual";

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const settings = await getSettings(db);

  // Gate Hour: hourly cron only proceeds at the configured Sofia hour.
  if (trigger === "cron" && sofiaHour() !== settings.notify_hour) {
    return Response.json({ skipped: true, reason: "gate" });
  }

  const runId = await openRun(db, trigger);
  try {
    const tmdbToken = Deno.env.get("TMDB_BEARER");
    if (!tmdbToken) throw new Error("TMDB_BEARER is not set");
    const today = sofiaToday();

    // ---- 1. Load state
    const lists = await getLists(db);
    const movies = await getAllMovies(db);
    const byImdb = new Map(movies.filter((m) => m.imdb_id).map((m) => [m.imdb_id!, m]));
    const byTmdb = new Map(movies.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id!, m]));

    // ---- 2. Sync each sync-enabled list (soft membership, never delete)
    const activeIds = new Set<number>();
    for (const list of lists) {
      if (!list.sync_enabled) {
        for (const m of await getMemberships(db, list.id)) if (m.on_list) activeIds.add(m.movie_id);
        continue;
      }
      const listMovieIds: number[] = [];
      if (list.kind === "imdb_watchlist") {
        const userId = String(list.config.imdb_user_id ?? "");
        if (!userId) throw new Error(`list ${list.id} (${list.name}) has no imdb_user_id`);
        const items = await fetchWatchlist(userId);
        for (const item of items) {
          let movie = byImdb.get(item.imdbId);
          if (!movie) {
            movie = await insertMovie(db, { imdb_id: item.imdbId, title: item.title, year: item.year });
            byImdb.set(item.imdbId, movie);
          }
          listMovieIds.push(movie.id);
        }
      } else {
        const items = await fetchDiscover(list.config as DiscoverConfig, tmdbToken);
        for (const item of items) {
          let movie = byTmdb.get(item.tmdbId);
          if (!movie) {
            movie = await insertMovie(db, {
              tmdb_id: item.tmdbId, title: item.title, year: item.year, poster_path: item.posterPath,
            });
            byTmdb.set(item.tmdbId, movie);
          }
          listMovieIds.push(movie.id);
        }
      }
      const wanted = new Set(listMovieIds);
      const existing = await getMemberships(db, list.id);
      for (const movieId of wanted) {
        const prev = existing.find((m) => m.movie_id === movieId);
        if (!prev || !prev.on_list) await upsertMembership(db, list.id, movieId, true);
      }
      for (const prev of existing) {
        if (prev.on_list && !wanted.has(prev.movie_id)) await upsertMembership(db, list.id, prev.movie_id, false);
      }
      for (const id of wanted) activeIds.add(id);
    }

    // ---- 3. Resolve identities: match imdb-only actives, merge collisions
    for (const movie of [...byImdb.values()]) {
      if (movie.tmdb_id || !activeIds.has(movie.id)) continue;
      const tmdbId = await findTmdbId(movie.imdb_id!, tmdbToken);
      if (!tmdbId) continue; // stays Unmatched, retried next run
      const existing = byTmdb.get(tmdbId);
      if (existing && existing.id !== movie.id) {
        await mergeMovies(db, movie.id, existing.id);
        await updateMovie(db, existing.id, { imdb_id: movie.imdb_id });
        existing.imdb_id = movie.imdb_id;
        byImdb.set(movie.imdb_id!, existing);
        activeIds.delete(movie.id);
        activeIds.add(existing.id);
      } else {
        await updateMovie(db, movie.id, { tmdb_id: tmdbId });
        movie.tmdb_id = tmdbId;
        byTmdb.set(tmdbId, movie);
      }
    }

    // ---- 4. Refresh active matched movies + compute effective dates + detect events
    const logStates = await getLogStates(db);
    const paused = settings.notifications_paused;
    const notifyEligible = new Set<number>();
    for (const list of lists) {
      if (!list.notifications_enabled) continue;
      for (const m of await getMemberships(db, list.id)) if (m.on_list) notifyEligible.add(m.movie_id);
    }

    const allMoviesNow = await getAllMovies(db);
    const active = allMoviesNow.filter((m) => activeIds.has(m.id) && m.tmdb_id);
    let matched = 0;
    const refreshedNewMovieIds: number[] = [];
    const pendingLog: {
      movie: MovieRow; medium: Medium; event: string; effective_date: string; silent: boolean;
    }[] = [];

    for (const movie of active) {
      const bundle = await fetchMovieBundle(movie.tmdb_id!, tmdbToken);
      if (!bundle) continue;
      matched++;
      const isNewMovie = movie.first_refreshed_at === null;
      if (isNewMovie) refreshedNewMovieIds.push(movie.id);
      const patch: Record<string, unknown> = {
        title: bundle.title ?? movie.title,
        year: bundle.year ?? movie.year,
        poster_path: bundle.posterPath ?? movie.poster_path,
      };
      if (bundle.imdbId && !movie.imdb_id && !byImdb.has(bundle.imdbId)) {
        patch.imdb_id = bundle.imdbId;
      }
      await replaceReleaseDates(db, movie.id, bundle.rawDates);
      await replaceProviders(db, movie.id, bundle.providers);

      for (const medium of MEDIUMS) {
        const eff = computeEffective(bundle.rawDates, settings.region_order, medium);
        patch[`${medium}_date`] = eff?.date ?? null;
        patch[`${medium}_region`] = eff?.region ?? null;
        const state = logStates.get(`${movie.id}:${medium}`) ??
          { announcedEver: false, releasedEver: false, lastLoggedDate: null };
        const detected = detectMediumEvents({
          currentEffective: eff?.date ?? null,
          state,
          isNewMovie,
          today,
        });
        for (const ev of detected) {
          const silent = ev.pastFactOnFirstObservation || paused || !notifyEligible.has(movie.id);
          pendingLog.push({ movie, medium, event: ev.event, effective_date: ev.effectiveDate, silent });
        }
      }
      await updateMovie(db, movie.id, patch);
    }

    // ---- 5. Log all events; deliver the non-silent ones
    const rows = pendingLog.map((p) => ({
      movie_id: p.movie.id, medium: p.medium, event: p.event,
      effective_date: p.effective_date, sent_at: null,
    }));
    const ids = await insertLogRows(db, rows);
    // A movie is "new" until its first refresh whose events were logged: stamping
    // only after insertLogRows means a crash mid-run leaves it re-detectable.
    await markFirstRefreshed(db, refreshedNewMovieIds);
    const toSend = pendingLog
      .map((p, i) => ({ ...p, logId: ids[i] }))
      .filter((p) => !p.silent);

    let notificationsSent = 0;
    if (toSend.length) {
      const appUrl = Deno.env.get("APP_URL") ?? "/";
      const digestEvents: DigestEvent[] = toSend.map((p) => ({
        movieTitle: p.movie.title ?? p.movie.imdb_id ?? String(p.movie.id),
        year: p.movie.year,
        medium: p.medium,
        event: p.event as DigestEvent["event"],
        effectiveDate: p.effective_date,
      }));

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && settings.notify_email) {
        try {
          const digest = buildDigest(digestEvents, appUrl);
          if (digest) {
            await sendDigest(resendKey, Deno.env.get("NOTIFY_FROM") ?? "onboarding@resend.dev", settings.notify_email, digest);
          }
        } catch (err) {
          console.error("email digest failed:", err);
        }
      } else {
        console.warn("RESEND_API_KEY or notify_email missing — skipping email digest");
      }

      const vapid = Deno.env.get("VAPID_KEYS_JSON");
      if (vapid) {
        try {
          const subs = await getSubscriptions(db);
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
        } catch (err) {
          console.error("push delivery failed:", err);
        }
      } else {
        console.warn("VAPID_KEYS_JSON missing — skipping push");
      }

      await markSent(db, toSend.map((p) => p.logId));
      notificationsSent = toSend.length;
    }

    const summary = {
      runId,
      moviesTotal: activeIds.size,
      moviesMatched: matched,
      eventsCreated: pendingLog.length,
      notificationsSent,
    };
    await closeRun(db, runId, {
      status: "success",
      movies_total: summary.moviesTotal,
      movies_matched: summary.moviesMatched,
      events_created: summary.eventsCreated,
      notifications_sent: summary.notificationsSent,
    });
    return Response.json(summary);
  } catch (err) {
    try {
      await closeRun(db, runId, { status: "error", error: String(err) });
    } catch (closeErr) {
      console.error("failed to close run:", closeErr);
    }
    console.error("refresh run failed:", err);
    return Response.json({ runId, error: String(err) }, { status: 500 });
  }
});
