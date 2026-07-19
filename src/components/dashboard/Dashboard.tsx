import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  statusOf,
  STATUS_ORDER,
  todayISO,
  type DerivedStatus,
} from "../../lib/dashboard";
import {
  applyControls,
  defaultControls,
  deriveOptions,
  loadControls,
  saveControls,
  type TableControls,
  toggleSort,
} from "../../lib/table-controls";
import { useAuth } from "../../lib/auth-context";
import { useLists, useListMovies, useRadar, useRefreshNow } from "../../lib/queries";
import { ConnectWatchlist } from "./ConnectWatchlist";
import { FilterToolbar } from "./FilterToolbar";
import { MovieDetailPanel } from "./MovieDetailPanel";
import { MovieList } from "./MovieList";
import { SideRail } from "./SideRail";

type Tab = "radar" | "connect" | number;
type RadarWindow = "recent" | "upcoming";

/**
 * The Console (SPEC §4, §10): one screen, two faces. Anonymous visitors get the
 * public Digital Release Radar; signed-in users get the same radar as the first
 * tab of a Radar | Watchlist | Followed switcher. The radar is region-selectable
 * (navbar) with a New-on-digital | Upcoming window toggle; the lists keep their
 * status stat-strip. The table controls (#57) and detail panel (#58) are shared.
 */
export function Dashboard({ region }: { region: string }) {
  const { user } = useAuth();
  const isAuth = !!user;
  const lists = useLists(isAuth);

  const [activeTab, setActiveTab] = useState<Tab>("radar");
  const [radarWindow, setRadarWindow] = useState<RadarWindow>("recent");
  const [filter, setFilter] = useState<DerivedStatus | null>(null);
  const [controls, setControls] = useState<TableControls>(defaultControls);
  const [selectedMovieId, setSelectedMovieId] = useState<number | null>(null);
  const today = todayISO();

  const hasWatchlist = (lists.data ?? []).some((l) => l.kind === "imdb_watchlist");
  const onConnect = isAuth && activeTab === "connect";
  const onRadar = !onConnect && (activeTab === "radar" || !isAuth); // anon only ever sees the radar
  const radar = useRadar(region, radarWindow);
  const listMovies = useListMovies(typeof activeTab === "number" ? activeTab : undefined);
  const source = onRadar ? radar : listMovies;
  const movies = useMemo(() => source.data ?? [], [source.data]);
  const activeList = (lists.data ?? []).find((l) => l.id === activeTab);
  const activeListKind = activeList?.kind;
  const activeImdbUserId =
    (activeList?.config as { imdb_user_id?: string } | undefined)?.imdb_user_id ?? null;
  const refresh = useRefreshNow();

  // Controls persist per surface: radar keys on region×window, lists on id.
  const controlsKey = onRadar ? `radar:${region}:${radarWindow}` : `list:${activeTab}`;
  useEffect(() => {
    // Upcoming is about what lands soonest → default to earliest digital date first.
    const defaultSort = onRadar && radarWindow === "upcoming"
      ? ({ key: "digital", dir: "asc" } as const)
      : undefined;
    setControls(loadControls(controlsKey, defaultSort));
    // controlsKey encodes region×window, so it changes whenever the surface does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsKey]);

  const updateControls = (next: TableControls) => {
    setControls(next);
    saveControls(controlsKey, next);
  };

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<DerivedStatus, number>;
    for (const m of movies) c[statusOf(m, today)]++;
    return c;
  }, [movies, today]);

  const options = useMemo(() => deriveOptions(movies), [movies]);

  const rows = useMemo(() => {
    const byStatus = onRadar ? movies : movies.filter((m) => !filter || statusOf(m, today) === filter);
    return applyControls(byStatus, controls, today);
  }, [movies, filter, controls, today, onRadar]);

  return (
    <div className="space-y-4">
      {/* Switcher: Radar is always first; lists follow for signed-in users. */}
      <div role="tablist" className="tabs tabs-box w-fit">
        <TabButton active={onRadar} onClick={() => { setActiveTab("radar"); setFilter(null); }}>
          Radar
        </TabButton>
        {isAuth && (lists.data ?? []).map((l) => (
          <TabButton key={l.id} active={activeTab === l.id} onClick={() => { setActiveTab(l.id); setFilter(null); }}>
            {l.name}
          </TabButton>
        ))}
        {lists.isLoading && <span className="loading loading-dots loading-sm mx-3 self-center" />}
      </div>

      {/* Watchlist is opt-in: no tab until connected — a promo prompts setup. */}
      {isAuth && !hasWatchlist && !onConnect && (
        <WatchlistPromo onConnect={() => { setActiveTab("connect"); setFilter(null); }} />
      )}

      {onConnect ? (
        <ConnectWatchlist reconnect={hasWatchlist} />
      ) : (
        <>
      {activeListKind === "imdb_watchlist" && (
        <WatchlistHeader
          imdbUserId={activeImdbUserId}
          onResync={() => refresh.mutate()}
          resyncing={refresh.isPending}
          onChange={() => { setActiveTab("connect"); setFilter(null); }}
        />
      )}
      {onRadar ? (
        /* Radar window toggle (SPEC §4): the product is dates, not statuses. */
        <div role="tablist" className="tabs tabs-boxed w-fit bg-base-100">
          {(["recent", "upcoming"] as const).map((w) => (
            <button
              key={w}
              role="tab"
              className={`tab ${radarWindow === w ? "tab-active" : ""}`}
              onClick={() => setRadarWindow(w)}
            >
              {w === "recent" ? "New on digital" : "Upcoming"}
            </button>
          ))}
        </div>
      ) : (
        /* Status stat-strip — click to filter (lists only). */
        <div className="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
          {STATUS_ORDER.map((s) => {
            const active = filter === s;
            return (
              <button
                key={s}
                className={`stat cursor-pointer text-left transition-colors hover:bg-base-200 ${active ? "bg-base-300" : ""}`}
                aria-pressed={active}
                onClick={() => setFilter(active ? null : s)}
              >
                <div className="stat-title text-xs">{s}</div>
                <div className="stat-value text-2xl">{counts[s]}</div>
              </button>
            );
          })}
        </div>
      )}

      {filter && !onRadar && (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span>Showing <span className="font-medium text-base-content">{filter}</span></span>
          <button className="btn btn-ghost btn-xs" onClick={() => setFilter(null)}>Clear filter</button>
        </div>
      )}

      <FilterToolbar
        options={options}
        sort={controls.sort}
        filters={controls.filters}
        onSortChange={(sort) => updateControls({ ...controls, sort })}
        onFiltersChange={(filters) => updateControls({ ...controls, filters })}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        {/* min-w-0: grid items default to min-width:auto and won't shrink below
            their content, which let the movie list (and its overflow-x-auto
            table) blow past the viewport on mobile — clamp it to the column. */}
        <div className="min-w-0">
          {source.isError ? (
            <LoadError message={(source.error as Error).message} />
          ) : source.isLoading ? (
            <div className="grid place-items-center py-16">
              <span className="loading loading-dots loading-lg text-primary" />
            </div>
          ) : activeListKind === "imdb_watchlist" && rows.length === 0 ? (
            <ConnectWatchlist reconnect />
          ) : (
            <MovieList
              movies={rows}
              today={today}
              sort={controls.sort}
              onToggleSort={(key) => updateControls({ ...controls, sort: toggleSort(controls.sort, key) })}
              onSelect={setSelectedMovieId}
            />
          )}
        </div>
        {isAuth ? <SideRail /> : <SignupRail />}
      </div>
        </>
      )}

      <MovieDetailPanel
        movieId={selectedMovieId}
        onClose={() => setSelectedMovieId(null)}
        activeRegion={onRadar ? region : "BG"}
        isAuthenticated={isAuth}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="tab" className={`tab ${active ? "tab-active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** Opt-in prompt shown until an IMDb watchlist is connected — replaces the old
 * always-present "+ Watchlist" tab (2026-07-19 UX request). */
function WatchlistPromo({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-box border border-base-300 bg-gradient-to-r from-base-200 to-base-100 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="text-2xl" aria-hidden="true">📋</span>
        <div className="flex-1">
          <div className="font-medium">Track your IMDb watchlist</div>
          <div className="text-sm text-base-content/60">
            Sync the movies you’ve saved on IMDb and get a push the moment each one lands on digital.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onConnect}>
          Connect watchlist
        </button>
      </div>
      <p className="mt-2 text-xs text-base-content/45">
        You can also set this up any time from Settings (the gear, top-right).
      </p>
    </div>
  );
}

/** The connected-watchlist header: labels the tab as IMDb, shows whose profile,
 * and offers inline re-sync / change. */
function WatchlistHeader({
  imdbUserId,
  onResync,
  resyncing,
  onChange,
}: {
  imdbUserId: string | null;
  onResync: () => void;
  resyncing: boolean;
  onChange: () => void;
}) {
  const profileUrl = imdbUserId ? `https://www.imdb.com/user/${imdbUserId}/watchlist` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border border-base-300 bg-base-100 px-4 py-2.5">
      <span className="badge badge-info badge-sm">IMDb Watchlist</span>
      {imdbUserId ? (
        <span className="text-sm text-base-content/70">
          Tracking{" "}
          <a
            href={profileUrl!}
            target="_blank"
            rel="noreferrer"
            className="link font-medium text-base-content"
            onClick={(e) => e.stopPropagation()}
          >
            {imdbUserId} ↗
          </a>
        </span>
      ) : (
        <span className="text-sm text-base-content/50">Synced from your IMDb watchlist</span>
      )}
      <span className="flex-1" />
      <button className="btn btn-ghost btn-xs" onClick={onResync} disabled={resyncing}>
        {resyncing && <span className="loading loading-spinner loading-xs" />}
        ↻ Re-sync
      </button>
      <button className="btn btn-ghost btn-xs" onClick={onChange}>
        Change…
      </button>
    </div>
  );
}

/** The anonymous right rail (SPEC §4): a signup call-to-action. */
function SignupRail() {
  return (
    <div className="card border border-primary/30 bg-base-100">
      <div className="card-body">
        <h3 className="card-title text-base">Track your own watchlist</h3>
        <p className="text-sm text-base-content/70">
          Sign up to sync your IMDb watchlist, follow any movie, and get a web-push alert the
          moment it lands on digital.
        </p>
        <ul className="mt-1 space-y-1 text-sm text-base-content/60">
          <li>• Search &amp; one-click follow</li>
          <li>• Per-region release tracking</li>
          <li>• Push notifications</li>
        </ul>
      </div>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="alert alert-error">
      <span>Couldn&apos;t load movies: {message}</span>
    </div>
  );
}
