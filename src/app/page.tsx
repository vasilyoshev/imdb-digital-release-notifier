"use client";
import { useEffect, useState } from "react";

type Status = {
  watchlistUrl: string | null;
  titleCount: number;
  knownCount: number;
  feed?: string;
};

type MatchItem = {
  wishlist: string;
  feedTitle: string;
  link?: string;
  pubDate?: string;
};

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);

  async function loadStatus() {
    const s = await fetch("/api/status").then(r => r.json());
    setStatus(s);
  }
  useEffect(() => { loadStatus(); }, []);

  async function manualRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Refresh failed");
      await loadStatus();
      (document.getElementById("refresh_toast") as HTMLDialogElement)?.showModal();
    } catch (e: any) {
      alert(e.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      const res = await fetch("/api/check", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Check failed");
      setMatches(data.matches || []);
    } catch (e: any) {
      alert(e.message || "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold">IMDb Digital Release Notifier</h1>
        <p className="opacity-70">
          Reads your IMDb watchlist ({status?.watchlistUrl || "set WATCHLIST_URL in .env.local"}) and matches against the DVDsReleaseDates RSS.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Refresh titles & check feed</h2>
              <p className="text-sm opacity-70">Runs one full cycle (fetch watchlist, parse RSS, email new matches).</p>
              <button className={`btn btn-primary ${refreshing ? "btn-disabled" : ""}`} onClick={manualRefresh} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
              <dialog id="refresh_toast" className="modal modal-bottom sm:modal-middle">
                <div className="modal-box">
                  <h3 className="font-bold text-lg">Done</h3>
                  <p className="py-4">Watchlist refreshed and feed checked. Emails sent for new matches.</p>
                  <div className="modal-action">
                    <form method="dialog"><button className="btn">OK</button></form>
                  </div>
                </div>
              </dialog>
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Check feed only</h2>
              <p className="text-sm opacity-70">Compares current stored titles to the RSS (no email).</p>
              <button className={`btn btn-secondary ${checking ? "btn-disabled" : ""}`} onClick={checkNow} disabled={checking}>
                {checking ? "Checking…" : "Check now"}
              </button>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">Status</h2>
            {!status ? (
              <div className="skeleton h-6 w-48" />
            ) : (
              <div className="stats stats-vertical lg:stats-horizontal shadow">
                <div className="stat">
                  <div className="stat-title">Watchlist</div>
                  <div className="stat-value text-sm truncate max-w-xs">{status.watchlistUrl || "—"}</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Stored Titles</div>
                  <div className="stat-value">{status.titleCount}</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Known Matches</div>
                  <div className="stat-value">{status.knownCount}</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Feed</div>
                  <div className="stat-value text-sm">{status.feed}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">Latest matches</h2>
            {matches.length === 0 ? (
              <div className="alert"><span>No matches yet. Try “Check now”.</span></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr><th>Wishlist</th><th>Feed Title</th><th>Date</th><th>Link</th></tr>
                  </thead>
                  <tbody>
                    {matches.map((m, i) => (
                      <tr key={i}>
                        <td className="font-medium">{m.wishlist}</td>
                        <td>{m.feedTitle}</td>
                        <td className="whitespace-nowrap">{m.pubDate || "—"}</td>
                        <td><a className="link link-primary" href={m.link} target="_blank">Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <footer className="text-center opacity-60 text-sm">
          Uses RSS: <code>https://feeds.feedburner.com/DVDsReleaseDates</code>
        </footer>
      </div>
    </div>
  );
}
