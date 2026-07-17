import { statusOf, type Movie } from "../../lib/dashboard";
import type { SortKey, SortState } from "../../lib/table-controls";
import { DateCell, Poster, ProviderChip, StatusBadge } from "./atoms";

/**
 * The dense watchlist table (SPEC §9). On md+ it's a real table with clickable
 * sortable headers; on mobile it collapses to stacked cards (sorted via the
 * toolbar's "Sort by…" control) — same data, no separate mobile navigation.
 */
export function MovieList({
  movies,
  today,
  sort,
  onToggleSort,
  onSelect,
  region = "BG",
}: {
  movies: Movie[];
  today: string;
  sort: SortState;
  onToggleSort: (key: SortKey) => void;
  onSelect: (movieId: number) => void;
  region?: string;
}) {
  if (movies.length === 0) {
    return (
      <div className="card border border-base-300 bg-base-100">
        <div className="card-body items-center py-16 text-center text-base-content/50">
          <p>No movies to show here.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="card hidden overflow-x-auto border border-base-300 bg-base-100 md:block">
        <table className="table table-sm">
          <thead>
            <tr>
              <SortableTh label="Movie" sortKey="title" sort={sort} onToggle={onToggleSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onToggle={onToggleSort} />
              <SortableTh label="Theatrical" sortKey="theatrical" sort={sort} onToggle={onToggleSort} />
              <SortableTh label="Digital" sortKey="digital" sort={sort} onToggle={onToggleSort} />
              <th>Where to watch ({region})</th>
            </tr>
          </thead>
          <tbody>
            {movies.map((m) => (
              <tr
                key={m.id}
                className="cursor-pointer hover:bg-base-200"
                onClick={() => onSelect(m.id)}
              >
                <td>
                  <div className="flex items-center gap-3">
                    <Poster movie={m} className="w-8 shrink-0" />
                    <div>
                      <div className="font-medium">{m.title ?? "Untitled"}</div>
                      <div className="text-xs opacity-60">{m.year ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <StatusBadge status={statusOf(m, today)} />
                </td>
                <td>
                  <DateCell date={m.theatricalDate} region={m.theatricalRegion} />
                </td>
                <td>
                  <DateCell date={m.digitalDate} region={m.digitalRegion} />
                </td>
                <td>
                  <ProviderCell movie={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {movies.map((m) => (
          <div
            key={m.id}
            className="card cursor-pointer border border-base-300 bg-base-100 shadow-sm active:bg-base-200"
            onClick={() => onSelect(m.id)}
          >
            <div className="card-body flex-row gap-3 p-3">
              <Poster movie={m} className="w-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {m.title ?? "Untitled"}
                    </div>
                    <div className="text-xs opacity-60">{m.year ?? "—"}</div>
                  </div>
                  <StatusBadge status={statusOf(m, today)} />
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="opacity-50">Theatrical</dt>
                  <dd>
                    <DateCell date={m.theatricalDate} region={m.theatricalRegion} />
                  </dd>
                  <dt className="opacity-50">Digital</dt>
                  <dd>
                    <DateCell date={m.digitalDate} region={m.digitalRegion} />
                  </dd>
                </dl>
                {m.providersBG.length > 0 && (
                  <div className="mt-2">
                    <ProviderCell movie={m} />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SortableTh({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button
        className="flex items-center gap-1 hover:text-base-content"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => onToggle(sortKey)}
      >
        {label}
        <span className={`text-xs ${active ? "opacity-100" : "opacity-30"}`}>
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function ProviderCell({ movie }: { movie: Movie }) {
  if (movie.providersBG.length === 0) {
    return <span className="opacity-40">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {movie.providersBG.map((p) => (
        <ProviderChip key={`${p.name}-${p.kind}`} provider={p} />
      ))}
    </div>
  );
}
