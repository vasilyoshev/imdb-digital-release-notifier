import { useState } from "react";
import { useAuth } from "../lib/auth-context";
import { useDeleteAccount, useLastRun, useRefreshNow } from "../lib/queries";
import { Mark } from "./Mark";
import { NavbarSearch } from "./NavbarSearch";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The app frame's top bar (SPEC §4, §9). Anonymous: wordmark · global search
 * (signup funnel) · region select · Sign in. Signed-in: adds the last-run badge,
 * Refresh now, settings gear, and the account menu.
 */
export function Navbar({
  onOpenSettings,
  onSignIn,
  region,
  onRegionChange,
  regions,
}: {
  onOpenSettings?: () => void;
  onSignIn?: () => void;
  region: string;
  onRegionChange: (r: string) => void;
  regions: { region: string; name: string }[];
}) {
  const { user, signOut } = useAuth();
  const lastRun = useLastRun(!!user);
  const refresh = useRefreshNow();
  const deleteAccount = useDeleteAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lastRunLabel = lastRun.isLoading
    ? "…"
    : !lastRun.data
      ? "never"
      : lastRun.data.status === "running"
        ? "running…"
        : lastRun.data.status === "error"
          ? "failed"
          : `${lastRun.data.finishedAt ? fmtTime(lastRun.data.finishedAt) : "—"} · ${
              lastRun.data.notificationsSent ?? 0
            } sent`;

  return (
    <>
      <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
      <div className="flex flex-1 items-center gap-3">
        <span className="flex items-center gap-2">
          <Mark className="h-6 w-6 text-primary" />
          <span className="wordmark text-2xl text-base-content">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
        </span>
        {user && (
          <span className="badge badge-ghost hidden gap-1 font-mono text-xs sm:inline-flex">
            <span className="opacity-60">last run</span> {lastRunLabel}
          </span>
        )}
      </div>

      <div className="flex flex-none items-center gap-2">
        <NavbarSearch />

        <select
          className="select select-sm select-bordered w-auto"
          aria-label="Region"
          value={region}
          onChange={(e) => onRegionChange(e.target.value)}
        >
          {regions.map((r) => (
            <option key={r.region} value={r.region}>
              {r.region}
            </option>
          ))}
        </select>

        {user ? (
          <>
            <button
              className="btn btn-sm btn-outline btn-primary"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              title="Run the pipeline now (bypasses the gate hour)"
            >
              {refresh.isPending && <span className="loading loading-spinner loading-xs" />}
              {refresh.isPending ? "Refreshing…" : "Refresh now"}
            </button>

            <button
              className="btn btn-ghost btn-sm btn-circle"
              onClick={() => onOpenSettings?.()}
              aria-label="Settings"
              title="Settings"
            >
              <GearIcon className="h-5 w-5" />
            </button>

            <div className="dropdown dropdown-end">
              <button tabIndex={0} className="btn btn-ghost btn-sm btn-circle" aria-label="Account menu">
                <UserIcon className="h-5 w-5" />
              </button>
              <ul
                tabIndex={0}
                className="dropdown-content menu z-40 mt-2 w-64 rounded-box border border-base-300 bg-base-100 shadow-xl"
              >
                <li className="menu-title truncate text-base-content/60">{user.email ?? "Signed in"}</li>
                <li>
                  <button onClick={() => void signOut()}>Sign out</button>
                </li>
                <li>
                  <button className="text-error" onClick={() => setConfirmDelete(true)}>
                    Delete account
                  </button>
                </li>
              </ul>
            </div>
          </>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => onSignIn?.()}>
            Sign in
          </button>
        )}
      </div>
      </header>

      {(refresh.isError || refresh.isSuccess) && (
        <div className="toast toast-end z-50">
          <div className={`alert ${refresh.isError ? "alert-error" : "alert-success"}`}>
            <span>
              {refresh.isError
                ? `Refresh failed: ${(refresh.error as Error).message}`
                : `Refresh complete — ${refresh.data?.eventsCreated ?? 0} events · ${
                    refresh.data?.notificationsSent ?? 0
                  } sent`}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => refresh.reset()}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-semibold">Delete your account?</h3>
            <p className="py-2 text-sm text-base-content/70">
              This permanently removes your watchlist sync, follows, settings, and push devices.
              Shared movie data stays. This can&apos;t be undone.
            </p>
            {deleteAccount.isError && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{(deleteAccount.error as Error).message}</span>
              </div>
            )}
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleteAccount.isPending}>
                Cancel
              </button>
              <button
                className="btn btn-error"
                disabled={deleteAccount.isPending}
                onClick={async () => {
                  await deleteAccount.mutateAsync();
                  await signOut();
                }}
              >
                {deleteAccount.isPending && <span className="loading loading-spinner loading-xs" />}
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GearIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.14.31.43.53.77.62H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function UserIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
