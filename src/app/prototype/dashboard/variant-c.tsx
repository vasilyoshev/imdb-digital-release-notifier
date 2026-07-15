"use client";
// PROTOTYPE — Variant C: "Phone app". Single mobile-width column with a
// bottom tab bar (Films / Calendar / Feed / Settings) — leans into the PWA
// identity. Calendar is a vertical agenda, not a grid. Install UX is a
// dedicated card in Settings with iOS Home-Screen steps.
import { useState } from "react";
import {
  LOG_ICON,
  MOVIES,
  NOTIFICATION_LOG,
  SETTINGS,
  STATUS_ORDER,
  TODAY,
  fmt,
  fmtFull,
  statusOf,
  upcomingEvents,
} from "./mock-data";
import { Poster, ProviderChip, StatusBadge } from "./bits";

type Tab = "films" | "calendar" | "feed" | "settings";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "films", icon: "🎞️", label: "Films" },
  { key: "calendar", icon: "📅", label: "Calendar" },
  { key: "feed", icon: "🔔", label: "Feed" },
  { key: "settings", icon: "⚙️", label: "Settings" },
];

export const VariantC = () => {
  const [tab, setTab] = useState<Tab>("films");

  const sortedMovies = [...MOVIES].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)),
  );

  const upcoming = upcomingEvents();
  const weekEnd = "2026-07-21";
  const monthEnd = "2026-07-31";
  const agenda: { label: string; events: typeof upcoming }[] = [
    { label: "This week", events: upcoming.filter((e) => e.date <= weekEnd) },
    {
      label: "Later in July",
      events: upcoming.filter((e) => e.date > weekEnd && e.date <= monthEnd),
    },
    { label: "August", events: upcoming.filter((e) => e.date.startsWith("2026-08")) },
    { label: "Beyond", events: upcoming.filter((e) => e.date > "2026-08-31") },
  ];

  return (
    <div className="min-h-screen bg-base-300 flex justify-center">
      <div className="w-full max-w-md bg-base-200 min-h-screen flex flex-col border-x border-base-300 shadow-xl">
        {/* top bar */}
        <header className="navbar bg-base-100 shadow-sm min-h-12 px-4 sticky top-0 z-20">
          <div className="flex-1 font-bold">🎬 Release Notifier</div>
          <div className="flex items-center gap-1 text-xs opacity-60">
            <span className="w-2 h-2 rounded-full bg-success inline-block" />
            Synced today 09:02
          </div>
        </header>

        <main className="flex-1 p-3 pb-24 overflow-y-auto">
          {tab === "films" && (
            <div className="grid grid-cols-2 gap-3">
              {sortedMovies.map((m) => {
                const s = statusOf(m);
                return (
                  <div key={m.imdbId} className="card bg-base-100 shadow">
                    <div className="relative">
                      <Poster movie={m} className="w-full rounded-b-none" />
                      <div className="absolute top-1.5 left-1.5">
                        <StatusBadge status={s} size="badge-xs" />
                      </div>
                    </div>
                    <div className="card-body p-2.5 gap-1">
                      <div
                        className="text-sm font-medium leading-tight truncate"
                        title={m.title}
                      >
                        {m.title}
                      </div>
                      <div className="text-xs opacity-60 space-y-0.5">
                        {m.theatrical && <div>🎬 {fmt(m.theatrical.date)}</div>}
                        {m.digital && <div>📺 {fmt(m.digital.date)}</div>}
                        {!m.theatrical && !m.digital && (
                          <div className="italic">
                            {m.unmatched ? "not matched yet" : "no dates yet"}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {m.providersBG.slice(0, 2).map((p) => (
                          <ProviderChip key={p.name} provider={p} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "calendar" && (
            <div className="space-y-4">
              {agenda
                .filter((g) => g.events.length)
                .map((g) => (
                  <div key={g.label}>
                    <h2 className="text-xs uppercase font-bold opacity-50 mb-2 px-1">
                      {g.label}
                    </h2>
                    <div className="card bg-base-100 shadow divide-y divide-base-200">
                      {g.events.map((e, i) => (
                        <div key={i} className="flex items-center gap-3 p-3">
                          <div className="text-center w-10 shrink-0">
                            <div className="text-lg font-bold leading-none">
                              {new Date(e.date).getDate()}
                            </div>
                            <div className="text-[10px] uppercase opacity-60">
                              {new Date(e.date).toLocaleDateString("en-GB", {
                                month: "short",
                              })}
                            </div>
                          </div>
                          <Poster movie={e.movie} className="w-8" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {e.movie.title}
                            </div>
                            <div className="text-xs opacity-60">
                              {e.medium === "theatrical"
                                ? "🎬 in theaters"
                                : "📺 digital"}{" "}
                              · {e.region}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {tab === "feed" && (
            <div className="space-y-2">
              <p className="text-xs opacity-50 px-1">
                Everything you were notified about, newest first. Seeded events
                are hidden.
              </p>
              {NOTIFICATION_LOG.map((l, i) => (
                <div key={i} className="card bg-base-100 shadow">
                  <div className="card-body p-3 flex-row gap-3 items-start">
                    <span className="text-xl">{LOG_ICON[l.kind]}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{l.movie}</div>
                      <div className="text-sm opacity-70">{l.detail}</div>
                      <div className="text-xs opacity-40 mt-0.5">
                        {fmtFull(l.at)}
                        {l.at.startsWith(TODAY) ? " · today" : ""}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "settings" && (
            <div className="space-y-3">
              <div className="card bg-base-100 shadow">
                <div className="card-body p-4 gap-2">
                  <div className="flex items-center gap-3">
                    <div className="avatar placeholder">
                      <div className="bg-neutral text-neutral-content w-10 rounded-full">
                        <span>V</span>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="font-medium">Signed in</div>
                      <div className="opacity-60 text-xs">
                        {SETTINGS.notifyEmail}
                      </div>
                    </div>
                    <button className="btn btn-xs btn-ghost ml-auto">
                      Sign out
                    </button>
                  </div>
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body p-4 gap-3">
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
                </div>
              </div>

              <div className="card bg-base-100 shadow">
                <div className="card-body p-4 gap-2">
                  <h3 className="font-medium text-sm">📲 Push notifications</h3>
                  <div className="text-sm space-y-1">
                    {SETTINGS.pushDevices.map((d) => (
                      <div key={d} className="flex justify-between items-center">
                        <span>📱 {d}</span>
                        <button className="btn btn-xs btn-ghost">remove</button>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-sm btn-primary mt-1">
                    Enable on this device
                  </button>
                  <div className="alert alert-soft text-xs mt-1">
                    <span>
                      <b>On iPhone:</b> push needs the app on your Home Screen —
                      tap <b>Share</b> → <b>Add to Home Screen</b>, open it from
                      there, then tap “Enable on this device”.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* bottom tab bar */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md grid grid-cols-4 bg-base-100 border-t border-base-300 z-20">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
                tab === t.key ? "text-primary font-medium" : "opacity-60"
              }`}
              onClick={() => setTab(t.key)}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
};
