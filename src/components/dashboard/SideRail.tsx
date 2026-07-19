import { useMemo, useState } from "react";
import { todayISO } from "../../lib/dashboard";
import { useActiveMovies, useNotificationLog } from "../../lib/queries";
import {
  describeLog,
  fmtChip,
  fmtSent,
  MEDIUM_ICON,
  upcomingFrom,
} from "../../lib/rail";

type Tab = "upcoming" | "history";

/**
 * The two-tab side rail (SPEC §9): Upcoming — a chronological timeline of
 * future effective dates across every active movie (the calendar) — and
 * History — the visible notification log, newest first. Both span all lists,
 * independent of the switcher.
 */
export function SideRail() {
  const [tab, setTab] = useState<Tab>("upcoming");

  return (
    <aside className="card h-fit border border-base-300 bg-base-100 lg:sticky lg:top-20">
      <div className="card-body gap-3 p-4">
        <div role="tablist" className="tabs tabs-box tabs-sm">
          <button
            role="tab"
            className={`tab flex-1 ${tab === "upcoming" ? "tab-active" : ""}`}
            onClick={() => setTab("upcoming")}
          >
            Upcoming
          </button>
          <button
            role="tab"
            className={`tab flex-1 ${tab === "history" ? "tab-active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>
        {tab === "upcoming" ? <Upcoming /> : <History />}
      </div>
    </aside>
  );
}

function Upcoming() {
  const movies = useActiveMovies();
  const today = todayISO();
  const events = useMemo(
    () => upcomingFrom(movies.data ?? [], today),
    [movies.data, today],
  );

  if (movies.isLoading) return <RailSpinner />;
  if (movies.isError) return <RailError message={(movies.error as Error).message} />;
  if (events.length === 0) {
    return <RailEmpty text="No upcoming releases. New dates land here as they’re announced." />;
  }

  return (
    <ol className="relative ml-1 border-l border-base-300">
      {events.map((e) => (
        <li key={`${e.movieId}-${e.medium}`} className="relative py-2 pl-5">
          <span
            className="absolute -left-[9px] top-3 grid h-4 w-4 place-items-center rounded-full bg-base-100 text-[10px] ring-1 ring-base-300"
            aria-hidden="true"
          >
            {MEDIUM_ICON[e.medium]}
          </span>
          <div className="font-mono text-xs text-base-content/60">
            {fmtChip(e.date)}
            {e.region && <sup className="ml-0.5 opacity-60">{e.region}</sup>}
          </div>
          <div className="text-sm">
            <span className="font-medium">{e.title}</span>
            <span className="text-base-content/50"> · {e.medium}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function History() {
  const log = useNotificationLog();

  if (log.isLoading) return <RailSpinner />;
  if (log.isError) return <RailError message={(log.error as Error).message} />;
  if ((log.data ?? []).length === 0) {
    return <RailEmpty text="No notifications sent yet. Delivered alerts show up here." />;
  }

  return (
    <ul className="flex flex-col divide-y divide-base-300">
      {(log.data ?? []).map((entry) => {
        const { icon, text } = describeLog(entry);
        return (
          <li key={`${entry.id}-${entry.channel}`} className="flex gap-3 py-3">
            <span className="text-base leading-none" aria-hidden="true">
              {icon}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{entry.movieTitle}</div>
              <div className="text-sm text-base-content/70">{text}</div>
              <div className="mt-0.5 font-mono text-[11px] text-base-content/40">
                {fmtSent(entry.sentAt)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RailSpinner() {
  return (
    <div className="grid place-items-center py-10">
      <span className="loading loading-dots loading-md text-primary" />
    </div>
  );
}

function RailEmpty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-base-content/50">{text}</p>;
}

function RailError({ message }: { message: string }) {
  return (
    <div role="alert" className="alert alert-error alert-sm text-sm">
      <span>{message}</span>
    </div>
  );
}
