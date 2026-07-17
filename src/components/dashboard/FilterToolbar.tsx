import {
  type FilterOptions,
  type Filters,
  filtersActive,
  type SortKey,
  type SortState,
  toggleSort,
} from "../../lib/table-controls";

const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  digital: "Digital date",
  theatrical: "Theatrical date",
  status: "Status",
  year: "Year",
};
const SORT_KEYS: SortKey[] = ["digital", "theatrical", "title", "status", "year"];

/**
 * The table's sort + filter toolbar (SPEC §10): a sort control with every field
 * (also the mobile "Sort by…"), provider/genre multi-selects built from what's
 * present in the list, and a year range. Status filtering stays on the stat
 * strip. Controlled — all state lives in the Dashboard and persists per list.
 */
export function FilterToolbar({
  options,
  sort,
  filters,
  onSortChange,
  onFiltersChange,
}: {
  options: FilterOptions;
  sort: SortState;
  filters: Filters;
  onSortChange: (s: SortState) => void;
  onFiltersChange: (f: Filters) => void;
}) {
  const clearAll = () =>
    onFiltersChange({ providers: [], genres: [], yearMin: null, yearMax: null });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Sort — all fields, mobile's "Sort by…" too. */}
      <div className="dropdown">
        <div tabIndex={0} role="button" className="btn btn-sm btn-outline">
          <span className="opacity-60">Sort:</span> {SORT_LABELS[sort.key]}
          <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>
        </div>
        <ul className="dropdown-content menu z-10 mt-1 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow">
          {SORT_KEYS.map((k) => (
            <li key={k}>
              <button
                className={sort.key === k ? "active" : ""}
                onClick={() => onSortChange(toggleSort(sort, k))}
              >
                {SORT_LABELS[k]}
                {sort.key === k && <span className="ml-auto">{sort.dir === "asc" ? "↑" : "↓"}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {options.providers.length > 0 && (
        <MultiSelect
          label="Providers"
          options={options.providers}
          selected={filters.providers}
          onChange={(providers) => onFiltersChange({ ...filters, providers })}
        />
      )}

      {options.genres.length > 0 && (
        <MultiSelect
          label="Genres"
          options={options.genres}
          selected={filters.genres}
          onChange={(genres) => onFiltersChange({ ...filters, genres })}
        />
      )}

      {options.yearBounds && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            aria-label="Year from"
            placeholder={String(options.yearBounds.min)}
            className="input input-sm input-bordered w-20"
            value={filters.yearMin ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, yearMin: e.target.value ? Number(e.target.value) : null })
            }
          />
          <span className="opacity-50">–</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label="Year to"
            placeholder={String(options.yearBounds.max)}
            className="input input-sm input-bordered w-20"
            value={filters.yearMax ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, yearMax: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>
      )}

      {filtersActive(filters) && (
        <button className="btn btn-ghost btn-sm" onClick={clearAll}>
          Clear filters
        </button>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);

  return (
    <div className="dropdown">
      <div tabIndex={0} role="button" className="btn btn-sm btn-outline">
        {label}
        {selected.length > 0 && <span className="badge badge-primary badge-sm">{selected.length}</span>}
      </div>
      <ul className="dropdown-content menu z-10 mt-1 max-h-72 w-56 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow">
        {options.map((opt) => (
          <li key={opt}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
              />
              <span className="truncate">{opt}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
