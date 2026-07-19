import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { type SearchHit, useFollow, useSearch } from "../lib/queries";

const TMDB_IMG = "https://image.tmdb.org/t/p/w92";

/**
 * Navbar global search (SPEC §11): a debounced box whose dropdown proxies TMDb
 * search and offers one-click Follow per row. Signed out, the box is visible but
 * focusing it shows the signup funnel — zero anonymous TMDb spend.
 */
export function NavbarSearch() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const follow = useFollow();
  // Debounce the query into the key the search hook reads (signed-in only; anon
  // never spends TMDb — the hook's `enabled` gate enforces that).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const search = useSearch(debouncedQ, !!user);

  const onToggleFollow = (h: SearchHit) => {
    follow.mutate({ tmdbId: h.tmdbId, action: h.followed ? "unfollow" : "follow" });
  };

  const hits = search.data ?? [];
  const showDropdown = open && (!user || q.trim().length >= 1);
  // Cover the debounce gap too, so we don't flash "No matches" before the query
  // for the latest term has started.
  const searching = search.isLoading || (q.trim().length >= 2 && debouncedQ.trim() !== q.trim());

  return (
    <div className="relative w-full sm:w-auto">
      <input
        type="search"
        className="input input-sm input-bordered w-full sm:w-56"
        placeholder="Search movies…"
        aria-label="Search movies"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showDropdown && (
        <div className="absolute top-full left-0 z-50 mt-1 w-80 max-w-[92vw] rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          {!user ? (
            <p className="p-3 text-sm">Sign up to search &amp; follow any movie.</p>
          ) : q.trim().length < 2 ? (
            <p className="p-3 text-sm opacity-60">Type to search…</p>
          ) : searching ? (
            <div className="grid place-items-center py-4">
              <span className="loading loading-dots loading-md text-primary" />
            </div>
          ) : hits.length === 0 ? (
            <p className="p-3 text-sm opacity-60">No matches.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {hits.map((h) => (
                <li key={h.tmdbId} className="flex items-center gap-2 rounded-lg p-1 hover:bg-base-200">
                  {h.posterPath ? (
                    <img src={`${TMDB_IMG}${h.posterPath}`} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-12 w-8 shrink-0 rounded bg-base-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.title}</div>
                    <div className="text-xs opacity-60">
                      {h.year ?? "—"}
                      {(h.followed || h.onWatchlist) && h.digitalDate ? ` · digital ${h.digitalDate}` : ""}
                    </div>
                  </div>
                  {h.followed ? (
                    // Manual follow — toggleable. preventDefault keeps the input
                    // focused so the dropdown stays open to show the flip.
                    <button
                      className="btn btn-success btn-xs"
                      title="Unfollow"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggleFollow(h)}
                      disabled={follow.isPending}
                    >
                      ✓ Following
                    </button>
                  ) : h.onWatchlist ? (
                    <span className="badge badge-outline badge-sm" title="On your IMDb watchlist">
                      On watchlist
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-xs"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggleFollow(h)}
                      disabled={follow.isPending}
                    >
                      Follow
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
