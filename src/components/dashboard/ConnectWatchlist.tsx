import { useState } from "react";
import { useRefreshNow, useSetWatchlist } from "../../lib/queries";

/**
 * The inline "connect your IMDb watchlist" card (2026-07-18 UX request) — shown
 * on the Watchlist tab so setup never means digging through settings. Paste a
 * profile/watchlist URL; on success it syncs immediately via Refresh-now.
 * (IMDb has no login/API and user profiles aren't name-searchable, so a pasted
 * URL / ur… id is the reliable path — with guidance on where to find it.)
 */
export function ConnectWatchlist({ reconnect = false }: { reconnect?: boolean }) {
  const [url, setUrl] = useState("");
  const setWatchlist = useSetWatchlist();
  const refresh = useRefreshNow();

  const connect = () =>
    setWatchlist.mutate(url.trim(), { onSuccess: () => refresh.mutate() });

  const syncing = refresh.isPending;
  const done = setWatchlist.isSuccess && (refresh.isSuccess || syncing);

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body max-w-xl">
        <h3 className="card-title text-base">
          {reconnect ? "Re-check your IMDb watchlist" : "Connect your IMDb watchlist"}
        </h3>
        <p className="text-sm text-base-content/70">
          Your <span className="font-medium">Watchlist</span> mirrors the movies you&apos;ve saved on
          IMDb — we track their theatrical &amp; digital releases automatically. Paste your IMDb
          profile or watchlist URL to sync it.
        </p>

        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            className="input input-bordered flex-1"
            placeholder="https://www.imdb.com/user/ur…/watchlist"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url.trim() && connect()}
          />
          <button
            className="btn btn-primary"
            disabled={!url.trim() || setWatchlist.isPending || syncing}
            onClick={connect}
          >
            {(setWatchlist.isPending || syncing) && <span className="loading loading-spinner loading-xs" />}
            {syncing ? "Syncing…" : "Connect"}
          </button>
        </div>

        {setWatchlist.isError && (
          <div role="alert" className="alert alert-error mt-1 py-2 text-sm">
            <span>{(setWatchlist.error as Error).message}</span>
          </div>
        )}
        {done && !setWatchlist.isError && (
          <p className="mt-1 text-sm text-success">
            Watchlist connected{syncing ? " — syncing now…" : "!"} It&apos;ll fill in shortly.
          </p>
        )}

        <details className="mt-2 text-xs text-base-content/50">
          <summary className="cursor-pointer">Where do I find this?</summary>
          <p className="mt-1">
            On imdb.com, open your profile (top-right avatar → Your profile). The address bar shows{" "}
            <code>imdb.com/user/ur…/</code> — paste that whole URL, or just the <code>ur…</code> part.
            Make sure your watchlist is set to public.
          </p>
        </details>
      </div>
    </div>
  );
}
