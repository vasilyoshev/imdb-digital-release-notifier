"use client";
// PROTOTYPE — Variant A: "Console". Dense desktop table of the whole
// watchlist, status stat-strip that filters it, right rail with
// Upcoming/History tabs. Settings in a modal; PWA install as a top banner.
import { useState } from "react";
import {
  DerivedStatus,
  LOG_ICON,
  LAST_RUN,
  MOVIES,
  NOTIFICATION_LOG,
  SETTINGS,
  STATUS_ORDER,
  fmt,
  fmtFull,
  statusOf,
  upcomingEvents,
} from "./mock-data";
import { Poster, ProviderChip, StatusBadge } from "./bits";

export const VariantA = () => {
  const [filter, setFilter] = useState<DerivedStatus | null>(null);
  const [railTab, setRailTab] = useState<"upcoming" | "history">("upcoming");
  const [installDismissed, setInstallDismissed] = useState(false);

  const counts = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, MOVIES.filter((m) => statusOf(m) === s).length]),
  ) as Record<DerivedStatus, number>;

  const rows = MOVIES.filter((m) => !filter || statusOf(m) === filter).sort(
    (a, b) =>
      STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)),
  );

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-sm px-4">
        <div className="flex-1 gap-3">
          <span className="text-lg font-bold">🎬 Release Notifier</span>
          <span className="badge badge-ghost hidden sm:inline-flex">
            Last run {fmt(LAST_RUN.at)} 09:02 · {LAST_RUN.eventsSent} events sent
          </span>
        </div>
        <div className="flex-none gap-2">
          <button className="btn btn-sm btn-outline">Refresh now</button>
          <button
            className="btn btn-sm btn-ghost btn-circle"
            onClick={() =>
              (
                document.getElementById("settings_modal") as HTMLDialogElement
              )?.showModal()
            }
            aria-label="Settings"
          >
            ⚙️
          </button>
          <div className="dropdown dropdown-end">
            <button tabIndex={0} className="btn btn-sm btn-ghost btn-circle">
              👤
            </button>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-100 rounded-box w-64 shadow z-10"
            >
              <li className="menu-title">{SETTINGS.notifyEmail}</li>
              <li>
                <a>Sign out</a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {!installDismissed && (
        <div className="alert alert-info rounded-none flex justify-between">
          <span>
            📲 Install this app to get push notifications on this device.
          </span>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary">Install</button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setInstallDismissed(true)}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <div className="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-100">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={`stat text-left cursor-pointer ${filter === s ? "bg-base-300" : ""}`}
              onClick={() => setFilter(filter === s ? null : s)}
            >
              <div className="stat-title text-xs">{s}</div>
              <div className="stat-value text-2xl">{counts[s]}</div>
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
          <div className="card bg-base-100 shadow overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Movie</th>
                  <th>Status</th>
                  <th>Theatrical</th>
                  <th>Digital</th>
                  <th>Where to watch (BG)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const s = statusOf(m);
                  return (
                    <tr key={m.imdbId}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Poster movie={m} className="w-8" />
                          <div>
                            <div className="font-medium">{m.title}</div>
                            <div className="text-xs opacity-60">{m.year}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={s} />
                      </td>
                      <td className="whitespace-nowrap">
                        {m.theatrical ? (
                          <>
                            {fmtFull(m.theatrical.date)}{" "}
                            <sup className="opacity-50">{m.theatrical.region}</sup>
                          </>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {m.digital ? (
                          <>
                            {fmtFull(m.digital.date)}{" "}
                            <sup className="opacity-50">{m.digital.region}</sup>
                          </>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td>
                        {m.providersBG.length ? (
                          <div className="flex flex-wrap gap-1">
                            {m.providersBG.map((p) => (
                              <ProviderChip key={p.name} provider={p} />
                            ))}
                          </div>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body p-4 gap-3">
              <div role="tablist" className="tabs tabs-box tabs-sm">
                <button
                  role="tab"
                  className={`tab flex-1 ${railTab === "upcoming" ? "tab-active" : ""}`}
                  onClick={() => setRailTab("upcoming")}
                >
                  Upcoming
                </button>
                <button
                  role="tab"
                  className={`tab flex-1 ${railTab === "history" ? "tab-active" : ""}`}
                  onClick={() => setRailTab("history")}
                >
                  History
                </button>
              </div>

              {railTab === "upcoming" ? (
                <ul className="timeline timeline-vertical timeline-compact -ml-4">
                  {upcomingEvents().map((e, i) => (
                    <li key={i}>
                      {i > 0 && <hr />}
                      <div className="timeline-middle text-sm">
                        {e.medium === "theatrical" ? "🎬" : "📺"}
                      </div>
                      <div className="timeline-end timeline-box text-sm w-full">
                        <span className="font-mono text-xs opacity-60 whitespace-nowrap">
                          {fmt(e.date)}
                        </span>{" "}
                        <span className="font-medium">{e.movie.title}</span>
                        <span className="opacity-60"> · {e.medium}</span>
                      </div>
                      {i < upcomingEvents().length - 1 && <hr />}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-3">
                  {NOTIFICATION_LOG.map((l, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span>{LOG_ICON[l.kind]}</span>
                      <div>
                        <div className="font-medium">{l.movie}</div>
                        <div className="opacity-70">{l.detail}</div>
                        <div className="text-xs opacity-40">{fmtFull(l.at)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <dialog id="settings_modal" className="modal">
        <div className="modal-box space-y-3">
          <h3 className="font-bold text-lg">Settings</h3>
          <label className="form-control w-full">
            <span className="label-text text-xs opacity-60">IMDb watchlist URL</span>
            <input
              className="input input-bordered input-sm w-full"
              defaultValue={SETTINGS.watchlistUrl}
              readOnly
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs opacity-60">Notification email</span>
            <input
              className="input input-bordered input-sm w-full"
              defaultValue={SETTINGS.notifyEmail}
              readOnly
            />
          </label>
          <div className="flex items-center justify-between text-sm">
            <span>Region order</span>
            <div className="join">
              {SETTINGS.regionOrder.map((r) => (
                <span key={r} className="btn btn-xs join-item">
                  {r}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Daily run</span>
            <span className="badge badge-ghost">{SETTINGS.gateHour}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Pause notifications</span>
            <input type="checkbox" className="toggle toggle-sm" readOnly />
          </div>
          <div className="modal-action">
            <form method="dialog">
              <button className="btn btn-sm">Close</button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
};
