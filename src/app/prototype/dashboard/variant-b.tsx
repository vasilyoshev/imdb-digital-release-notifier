"use client";
// PROTOTYPE — Variant B: "Calendar-first". A month calendar is the hero;
// the watchlist is a horizontal poster rail below it. Notification history
// lives in a right-side drawer behind a bell; settings swap the main view
// via a slim icon sidebar. PWA install as a corner toast.
import { useState } from "react";
import {
  LOG_ICON,
  MOVIES,
  NOTIFICATION_LOG,
  SETTINGS,
  STATUS_ORDER,
  TODAY,
  eventsInMonth,
  fmtFull,
  statusOf,
} from "./mock-data";
import { Poster, ProviderChip, StatusBadge } from "./bits";

const MONTHS = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 }, // July (default)
  { year: 2026, month: 7 },
  { year: 2026, month: 8 },
  { year: 2026, month: 9 },
];

export const VariantB = () => {
  const [view, setView] = useState<"calendar" | "settings">("calendar");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [monthIdx, setMonthIdx] = useState(1);
  const [toastDismissed, setToastDismissed] = useState(false);

  const { year, month } = MONTHS[monthIdx];
  const monthName = new Date(year, month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const events = eventsInMonth(year, month);

  const sortedMovies = [...MOVIES].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)),
  );

  return (
    <div className="min-h-screen bg-base-200 flex">
      {/* slim icon sidebar */}
      <aside className="w-14 bg-base-100 shadow flex flex-col items-center py-4 gap-2 sticky top-0 h-screen">
        <span className="text-xl mb-2" title="Release Notifier">
          🎬
        </span>
        <button
          className={`btn btn-ghost btn-square ${view === "calendar" ? "btn-active" : ""}`}
          onClick={() => setView("calendar")}
          title="Calendar"
        >
          📅
        </button>
        <button
          className="btn btn-ghost btn-square indicator"
          onClick={() => setHistoryOpen(true)}
          title="Notification history"
        >
          <span className="indicator-item badge badge-primary badge-xs">2</span>
          🔔
        </button>
        <button
          className={`btn btn-ghost btn-square ${view === "settings" ? "btn-active" : ""}`}
          onClick={() => setView("settings")}
          title="Settings"
        >
          ⚙️
        </button>
        <div className="mt-auto flex flex-col items-center gap-2">
          <button className="btn btn-ghost btn-square" title="Refresh now">
            🔄
          </button>
          <button
            className="btn btn-ghost btn-square"
            title={`${SETTINGS.notifyEmail} — sign out`}
          >
            👤
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 space-y-4 max-w-6xl mx-auto w-full">
        {view === "calendar" ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setMonthIdx(Math.max(0, monthIdx - 1))}
                  disabled={monthIdx === 0}
                >
                  ←
                </button>
                <h1 className="text-xl font-bold w-44 text-center">
                  {monthName}
                </h1>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setMonthIdx(Math.min(MONTHS.length - 1, monthIdx + 1))
                  }
                  disabled={monthIdx === MONTHS.length - 1}
                >
                  →
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="badge badge-ghost">
                  Regions: {SETTINGS.regionOrder.join(" → ")}
                </span>
                <span className="badge badge-warning badge-outline">🎬 theatrical</span>
                <span className="badge badge-success badge-outline">📺 digital</span>
              </div>
            </div>

            <div className="card bg-base-100 shadow p-3">
              <div className="grid grid-cols-7 gap-px text-xs opacity-60 mb-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="px-2 py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-base-300 rounded overflow-hidden">
                {Array.from({ length: firstOffset }).map((_, i) => (
                  <div key={`pad-${i}`} className="bg-base-100 min-h-20" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = events.filter((e) => e.date === iso);
                  const isToday = iso === TODAY;
                  const isPast = iso < TODAY;
                  return (
                    <div
                      key={day}
                      className={`bg-base-100 min-h-20 p-1 ${isPast ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`text-xs px-1 rounded-full ${isToday ? "bg-primary text-primary-content font-bold" : "opacity-60"}`}
                      >
                        {day}
                      </span>
                      <div className="space-y-0.5 mt-0.5">
                        {dayEvents.map((e, j) => (
                          <div
                            key={j}
                            className={`text-[10px] leading-tight rounded px-1 py-0.5 truncate ${
                              e.medium === "theatrical"
                                ? "bg-warning/20 text-warning-content"
                                : "bg-success/20 text-success-content"
                            }`}
                            title={`${e.movie.title} — ${e.medium} (${e.region})`}
                          >
                            {e.medium === "theatrical" ? "🎬" : "📺"}{" "}
                            {e.movie.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="font-bold mb-2">Watchlist</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {sortedMovies.map((m) => {
                  const s = statusOf(m);
                  return (
                    <div
                      key={m.imdbId}
                      className="card bg-base-100 shadow w-36 shrink-0"
                    >
                      <Poster movie={m} className="w-full rounded-b-none" />
                      <div className="card-body p-2 gap-1">
                        <div
                          className="text-xs font-medium leading-tight truncate"
                          title={m.title}
                        >
                          {m.title}
                        </div>
                        <StatusBadge status={s} size="badge-xs" />
                        {m.digital && (
                          <div className="text-[10px] opacity-60">
                            📺 {fmtFull(m.digital.date)}
                          </div>
                        )}
                        {m.providersBG.slice(0, 1).map((p) => (
                          <ProviderChip key={p.name} provider={p} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="max-w-md mx-auto card bg-base-100 shadow">
            <div className="card-body space-y-2">
              <h1 className="card-title">Settings</h1>
              <label className="form-control">
                <span className="label-text text-xs opacity-60">
                  IMDb watchlist URL
                </span>
                <input
                  className="input input-bordered input-sm"
                  defaultValue={SETTINGS.watchlistUrl}
                  readOnly
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs opacity-60">
                  Notification email
                </span>
                <input
                  className="input input-bordered input-sm"
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
              <div className="text-sm">
                <div className="opacity-60 text-xs mb-1">Push devices</div>
                {SETTINGS.pushDevices.map((d) => (
                  <div key={d} className="flex justify-between items-center">
                    <span>📱 {d}</span>
                    <button className="btn btn-xs btn-ghost">remove</button>
                  </div>
                ))}
              </div>
              <button className="btn btn-sm btn-outline mt-2">Sign out</button>
            </div>
          </div>
        )}
      </main>

      {/* history drawer */}
      {historyOpen && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-80 bg-base-100 shadow-xl p-4 overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Notification history</h2>
              <button
                className="btn btn-sm btn-ghost btn-circle"
                onClick={() => setHistoryOpen(false)}
              >
                ✕
              </button>
            </div>
            <p className="text-xs opacity-50">
              Everything you were notified about. Seeded events are hidden.
            </p>
            {NOTIFICATION_LOG.map((l, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span>{LOG_ICON[l.kind]}</span>
                <div>
                  <div className="font-medium">{l.movie}</div>
                  <div className="opacity-70">{l.detail}</div>
                  <div className="text-xs opacity-40">{fmtFull(l.at)}</div>
                </div>
              </div>
            ))}
          </aside>
        </div>
      )}

      {!toastDismissed && (
        <div className="toast toast-end z-30">
          <div className="alert shadow-lg">
            <span>📲 Install for push notifications?</span>
            <div className="flex gap-1">
              <button className="btn btn-xs btn-primary">Install</button>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => setToastDismissed(true)}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
