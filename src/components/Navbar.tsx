import { useAuth } from "../lib/auth-context";
import { Mark } from "./Mark";

/**
 * The app frame's top bar (SPEC §9). Structure matches the "Console" prototype:
 * wordmark · last-run summary · Refresh now · settings gear · account menu.
 * Refresh and settings are present but inert here — they get wired in the
 * refresh/settings slices (#34). The last-run summary is a placeholder until
 * refresh_runs data is fetched.
 */
export function Navbar() {
  const { user, signOut } = useAuth();

  return (
    <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
      <div className="flex flex-1 items-center gap-3">
        <span className="flex items-center gap-2">
          <Mark className="h-6 w-6 text-primary" />
          <span className="wordmark text-2xl text-base-content">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
        </span>
        <span className="badge badge-ghost hidden gap-1 font-mono text-xs sm:inline-flex">
          <span className="opacity-60">last run</span> never
        </span>
      </div>

      <div className="flex flex-none items-center gap-2">
        <button
          className="btn btn-sm btn-outline btn-primary"
          disabled
          title="Available once the refresh slice lands"
        >
          Refresh now
        </button>

        <button
          className="btn btn-ghost btn-sm btn-circle"
          disabled
          aria-label="Settings"
          title="Settings arrive with the settings slice"
        >
          <GearIcon className="h-5 w-5" />
        </button>

        <div className="dropdown dropdown-end">
          <button
            tabIndex={0}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Account menu"
          >
            <UserIcon className="h-5 w-5" />
          </button>
          <ul
            tabIndex={0}
            className="dropdown-content menu z-40 mt-2 w-64 rounded-box border border-base-300 bg-base-100 shadow-xl"
          >
            <li className="menu-title truncate text-base-content/60">
              {user?.email ?? "Signed in"}
            </li>
            <li>
              <button onClick={() => void signOut()}>Sign out</button>
            </li>
          </ul>
        </div>
      </div>
    </header>
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
