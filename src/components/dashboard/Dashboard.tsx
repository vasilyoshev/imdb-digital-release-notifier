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
import { useLists, useListMovies, useRadar } from "../../lib/queries";
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
  const activeListKind = (lists.data ?? []).find((l) => l.id === activeTab)?.kind;

  // Controls persist per surface: radar keys on region×window, lists on id.
  const controlsKey = onRadar ? `radar:${region}:${radarWindow}` : `list:${activeTab}`;
  useEffect(() => {
    setControls(loadControls(controlsKey));
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
        {isAuth && !hasWatchlist && (
          <TabButton active={onConnect} onClick={() => { setActiveTab("connect"); setFilter(null); }}>
            + Watchlist
          </TabButton>
        )}
        {lists.isLoading && <span className="loading loading-dots loading-sm mx-3 self-center" />}
      </div>

      {onConnect ? (
        <ConnectWatchlist />
      ) : (
        <>
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
              region={onRadar ? region : "BG"}
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
