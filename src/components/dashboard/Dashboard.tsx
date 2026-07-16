import { useMemo, useState } from "react";
import {
  statusOf,
  STATUS_ORDER,
  todayISO,
  type DerivedStatus,
} from "../../lib/dashboard";
import { useLists, useListMovies } from "../../lib/queries";
import { MovieList } from "./MovieList";

/**
 * The core of the single screen (SPEC §9): a list switcher scoping a status
 * stat-strip and the dense movie table. Stat clicks filter the table; the
 * switcher re-scopes everything to the chosen list.
 */
export function Dashboard() {
  const lists = useLists();
  const [activeList, setActiveList] = useState<number | null>(null);
  const [filter, setFilter] = useState<DerivedStatus | null>(null);

  // Default to the first list once they load.
  const listId = activeList ?? lists.data?.[0]?.id;
  const movies = useListMovies(listId);
  const today = todayISO();

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      DerivedStatus,
      number
    >;
    for (const m of movies.data ?? []) c[statusOf(m, today)]++;
    return c;
  }, [movies.data, today]);

  const rows = useMemo(() => {
    const all = movies.data ?? [];
    return all
      .filter((m) => !filter || statusOf(m, today) === filter)
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(statusOf(a, today)) -
            STATUS_ORDER.indexOf(statusOf(b, today)) ||
          (a.title ?? "").localeCompare(b.title ?? ""),
      );
  }, [movies.data, filter, today]);

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

      {/* The table / cards */}
      {movies.isError ? (
        <LoadError message={(movies.error as Error).message} />
      ) : movies.isLoading ? (
        <div className="grid place-items-center py-16">
          <span className="loading loading-dots loading-lg text-primary" />
        </div>
      ) : (
        <MovieList movies={rows} today={today} />
      )}
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
