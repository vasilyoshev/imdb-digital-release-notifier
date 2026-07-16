import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Mark } from "./Mark";
import { AttributionLine } from "./Footer";

/**
 * The only unauthenticated view (SPEC §10). A "projection booth" sign-in:
 * marquee bulbs over the wordmark, a soft projector glow, one amber CTA.
 * On success the auth listener swaps in the app shell — no manual redirect.
 */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success, onAuthStateChange re-renders the app; leave the button busy.
  }

  async function onGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    // Success navigates the browser to Google; only an init error returns here.
    if (error) setError(error.message);
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-base-200 px-4">
      {/* Projector glow spilling from the top of the booth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] max-w-[120vw] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(242,181,68,0.28), transparent 70%)",
        }}
      />

      <main className="relative z-10 w-full max-w-sm">
        <header className="mb-8 text-center">
          <MarqueeBulbs />
          <h1 className="wordmark mt-3 text-5xl text-base-content">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </h1>
          <p className="mt-2 text-sm text-base-content/60">
            Theatrical &amp; digital alerts for your IMDb watchlist.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="card border border-base-300 bg-base-100 shadow-xl"
        >
          <div className="card-body gap-4">
            <button
              type="button"
              onClick={() => void onGoogle()}
              className="btn w-full gap-2 border-base-300 bg-base-200 hover:bg-base-300"
            >
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </button>

            <div className="divider my-0 text-xs text-base-content/40">
              or with email
            </div>

            <div className="flex items-center gap-2 text-base-content/70">
              <Mark className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">Sign in to your console</span>
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-xs font-medium text-base-content/60"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-xs font-medium text-base-content/60"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
              />
            </div>

            {error && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary w-full"
            >
              {busy && <span className="loading loading-spinner loading-sm" />}
              {busy ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-center text-xs text-base-content/40">
              Private console · one account, by invitation only.
            </p>
          </div>
        </form>

        <footer className="mt-6 text-center">
          <AttributionLine />
        </footer>
      </main>
    </div>
  );
}

/** A strip of amber marquee bulbs — the login's signature flourish. */
function MarqueeBulbs() {
  return (
    <div className="flex justify-center gap-2" aria-hidden="true">
      {Array.from({ length: 11 }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-primary"
          style={{ boxShadow: "0 0 6px 1px rgba(242,181,68,0.7)" }}
        />
      ))}
    </div>
  );
}

/** Google's multi-colour "G" mark. */
function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
