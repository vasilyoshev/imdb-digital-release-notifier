/**
 * PROTOTYPE (ticket #42) — Variant A "Console radar".
 * The anonymous view IS the Console: same navbar bones (wordmark · region ·
 * Sign in), a stat strip, the dense movie table with a Recent|Upcoming toggle,
 * and the right rail carrying the signup pitch + upcoming timeline. Signing up
 * feels like unlocking more of the same product.
 */
import { useState } from "react";
import { Mark } from "../../components/Mark";
import { bucketFor, fmtFull, fmtShort, type Region } from "./data";
import { Attribution, ProviderChips, RadarPoster, RegionSelect } from "./bits";

export const NAME = "Console radar";

export function VariantA({ region, onRegion }: { region: Region; onRegion: (r: Region) => void }) {
  const { recent, upcoming } = bucketFor(region);
  const [tab, setTab] = useState<"recent" | "upcoming">("recent");
  const rows = tab === "recent" ? recent : upcoming;

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
        <div className="flex flex-1 items-center gap-3">
          <Mark className="h-6 w-6 text-primary" />
          <span className="wordmark text-2xl">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
          <span className="badge badge-ghost hidden font-mono text-xs sm:inline-flex">digital release radar</span>
        </div>
        <div className="flex items-center gap-2">
          <RegionSelect region={region} onChange={onRegion} />
          <button className="btn btn-sm btn-primary">Sign in</button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="join">
                <button
                  className={`btn btn-sm join-item ${tab === "recent" ? "btn-primary" : "btn-ghost border-base-300"}`}
                  onClick={() => setTab("recent")}
                >
                  New on digital
                  <span className="badge badge-sm">{recent.length}</span>
                </button>
                <button
                  className={`btn btn-sm join-item ${tab === "upcoming" ? "btn-primary" : "btn-ghost border-base-300"}`}
                  onClick={() => setTab("upcoming")}
                >
                  Upcoming
                  <span className="badge badge-sm">{upcoming.length}</span>
                </button>
              </div>
              <div className="stats stats-horizontal bg-base-100 shadow-sm">
                <div className="stat px-4 py-1">
                  <div className="stat-title text-xs">Out now</div>
                  <div className="stat-value text-lg text-success">{recent.length}</div>
                </div>
                <div className="stat px-4 py-1">
                  <div className="stat-title text-xs">This month</div>
                  <div className="stat-value text-lg text-info">{upcoming.length}</div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide">
                    <th></th>
                    <th>Title</th>
                    <th>Digital ({region})</th>
                    <th>Theatrical</th>
                    <th>Where to watch</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="hover">
                      <td className="w-12">
                        <RadarPoster movie={m} className="w-9" />
                      </td>
                      <td>
                        <span className="font-medium">{m.title}</span>{" "}
                        <span className="opacity-50">({m.year})</span>
                      </td>
                      <td className="font-mono text-xs whitespace-nowrap">
                        {fmtFull(m.digital[region]!)}
                        {tab === "upcoming" && (
                          <span className="badge badge-sm badge-info ml-2">
                            in {Math.max(1, Math.round((+new Date(m.digital[region]!) - +new Date("2026-07-16")) / 86400000))}d
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-xs whitespace-nowrap opacity-70">
                        {m.theatricalDate ? fmtFull(m.theatricalDate) : "—"}
                      </td>
                      <td>
                        <ProviderChips providers={m.providers} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <div className="card border border-primary/40 bg-base-100 shadow-sm">
              <div className="card-body gap-2 p-4">
                <h3 className="card-title text-base">Track your own watchlist</h3>
                <p className="text-sm opacity-70">
                  Sign in to sync your IMDB watchlist, follow any movie, and get a push
                  notification the day it hits streaming.
                </p>
                <button className="btn btn-primary btn-sm mt-1">Create a free account</button>
              </div>
            </div>

            <div className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <h3 className="mb-2 font-mono text-xs uppercase tracking-wide opacity-60">
                  Upcoming in {region}
                </h3>
                <ul className="timeline timeline-vertical timeline-compact -ml-4">
                  {upcoming.slice(0, 6).map((m, i) => (
                    <li key={m.id}>
                      {i > 0 && <hr />}
                      <div className="timeline-middle">
                        <span className="badge badge-xs badge-primary" />
                      </div>
                      <div className="timeline-end mb-2">
                        <span className="font-mono text-xs text-primary">{fmtShort(m.digital[region]!)}</span>
                        <div className="text-sm">{m.title}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </main>
      <Attribution />
    </div>
  );
}
