import { useEffect, useMemo, useState } from "react";
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
import { useLists, useListMovies } from "../../lib/queries";
import { FilterToolbar } from "./FilterToolbar";
import { MovieList } from "./MovieList";
import { SideRail } from "./SideRail";

/**
 * The core of the single screen (SPEC §9): a list switcher scoping a status
 * stat-strip and the dense movie table. Stat clicks filter the table; the
 * switcher re-scopes everything to the chosen list.
 */
export function Dashboard() {
  const lists = useLists();
  const [activeList, setActiveList] = useState<number | null>(null);
  const [filter, setFilter] = useState<DerivedStatus | null>(null);
  const [controls, setControls] = useState<TableControls>(defaultControls);

  // Default to the first list once they load.
  const listId = activeList ?? lists.data?.[0]?.id;
  const movies = useListMovies(listId);
  const today = todayISO();

  // Sort + filter state persists per list/tab (localStorage) — load on switch.
  useEffect(() => {
    if (listId != null) setControls(loadControls(listId));
  }, [listId]);

  const updateControls = (next: TableControls) => {
    setControls(next);
    if (listId != null) saveControls(listId, next);
  };

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      DerivedStatus,
      number
    >;
    for (const m of movies.data ?? []) c[statusOf(m, today)]++;
    return c;
  }, [movies.data, today]);

  const options = useMemo(() => deriveOptions(movies.data ?? []), [movies.data]);

  const rows = useMemo(() => {
    // Stat-strip status filter composes with the toolbar filters + sort.
    const byStatus = (movies.data ?? []).filter((m) => !filter || statusOf(m, today) === filter);
    return applyControls(byStatus, controls, today);
  }, [movies.data, filter, controls, today]);

  if (lists.isError) {
    return <LoadError message={(lists.error as Error).message} />;
  }

  return (
    <div className="space-y-4">
      {/* List switcher */}
      <div role="tablist" className="tabs tabs-box w-fit">
        {(lists.data ?? []).map((l) => (
          <button
            key={l.id}
            role="tab"
            className={`tab ${listId === l.id ? "tab-active" : ""}`}
            onClick={() => {
              setActiveList(l.id);
              setFilter(null);
            }}
          >
            {l.name}
          </button>
        ))}
        {lists.isLoading && (
          <span className="loading loading-dots loading-sm mx-3 self-center" />
        )}
      </div>

      {/* Status stat-strip — click to filter */}
      <div className="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
        {STATUS_ORDER.map((s) => {
          const active = filter === s;
          return (
            <button
              key={s}
              className={`stat cursor-pointer text-left transition-colors hover:bg-base-200 ${
                active ? "bg-base-300" : ""
              }`}
              aria-pressed={active}
              onClick={() => setFilter(active ? null : s)}
            >
              <div className="stat-title text-xs">{s}</div>
              <div className="stat-value text-2xl">{counts[s]}</div>
            </button>
          );
        })}
      </div>

      {filter && (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span>
            Showing <span className="font-medium text-base-content">{filter}</span>
          </span>
          <button className="btn btn-ghost btn-xs" onClick={() => setFilter(null)}>
            Clear filter
          </button>
        </div>
      )}

      {/* Sort + provider/genre/year controls (persist per list/tab) */}
      <FilterToolbar
        options={options}
        sort={controls.sort}
        filters={controls.filters}
        onSortChange={(sort) => updateControls({ ...controls, sort })}
        onFiltersChange={(filters) => updateControls({ ...controls, filters })}
      />

      {/* The table / cards, with the Upcoming/History rail alongside */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div>
          {movies.isError ? (
            <LoadError message={(movies.error as Error).message} />
          ) : movies.isLoading ? (
            <div className="grid place-items-center py-16">
              <span className="loading loading-dots loading-lg text-primary" />
            </div>
          ) : (
            <MovieList
              movies={rows}
              today={today}
              sort={controls.sort}
              onToggleSort={(key) => updateControls({ ...controls, sort: toggleSort(controls.sort, key) })}
            />
          )}
        </div>
        <SideRail />
      </div>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="alert alert-error">
      <span>Couldn&apos;t load your movies: {message}</span>
    </div>
  );
}
