import { useState } from "react";
import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import { ConfigurePage } from "./components/ConfigurePage";
import { LoginScreen } from "./components/LoginScreen";

/**
 * The route guard (SPEC §4, §10). No redirect for signed-out visitors: the app
 * shell renders the public Digital Release Radar for everyone, and "Sign in" is
 * a view you opt into. On sign-in the auth listener swaps in the signed-in
 * Console automatically.
 *
 * One real route besides the shell: the Stremio addon configure page (map
 * #109), reachable as /configure, /{token}/configure and /c/{config}/configure.
 * The prefixed forms are what Stremio's Configure button opens — a token is
 * ignored there (edits are RLS-scoped to the signed-in user) and only makes the
 * URL round-trip, while an anonymous config is decoded to prefill the page.
 * Signed out, the page still works: radar-only catalogs encoded into the
 * install link, no account required (#118).
 */
export default function App() {
  const { session, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const path = window.location.pathname;
  const isConfigure =
    path === "/configure" ||
    /^\/[0-9a-f]{48}\/configure$/.test(path) ||
    /^\/c\/[^/]+\/configure$/.test(path);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <span className="loading loading-dots loading-lg text-primary" />
      </div>
    );
  }

  if (isConfigure) {
    if (!session && showLogin) return <LoginScreen onBack={() => setShowLogin(false)} />;
    if (!session) return <ConfigurePage anonymous onSignIn={() => setShowLogin(true)} />;
    return <ConfigurePage />;
  }

  if (!session && showLogin) {
    return <LoginScreen onBack={() => setShowLogin(false)} />;
  }

  return <AppShell onSignIn={() => setShowLogin(true)} />;
}
