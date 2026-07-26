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
 * One real route besides the shell: /configure and /{token}/configure — the
 * Stremio addon configure page (map #109). The token'd form is what Stremio's
 * Configure button opens; the token in the URL is ignored (edits are RLS-scoped
 * to the signed-in user), it only makes the URL round-trip.
 */
export default function App() {
  const { session, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const path = window.location.pathname;
  const isConfigure = path === "/configure" || /^\/[0-9a-f]{48}\/configure$/.test(path);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <span className="loading loading-dots loading-lg text-primary" />
      </div>
    );
  }

  if (isConfigure) {
    if (!session) return <LoginScreen onBack={() => window.location.assign("/")} />;
    return <ConfigurePage />;
  }

  if (!session && showLogin) {
    return <LoginScreen onBack={() => setShowLogin(false)} />;
  }

  return <AppShell onSignIn={() => setShowLogin(true)} />;
}
