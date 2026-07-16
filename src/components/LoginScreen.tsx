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
