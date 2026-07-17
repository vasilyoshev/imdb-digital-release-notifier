import { useState } from "react";
import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

/**
 * The route guard (SPEC §4, §10). No redirect for signed-out visitors: the app
 * shell renders the public Digital Release Radar for everyone, and "Sign in" is
 * a view you opt into. On sign-in the auth listener swaps in the signed-in
 * Console automatically.
 */
export default function App() {
  const { session, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <span className="loading loading-dots loading-lg text-primary" />
      </div>
    );
  }

  if (!session && showLogin) {
    return <LoginScreen onBack={() => setShowLogin(false)} />;
  }

  return <AppShell onSignIn={() => setShowLogin(true)} />;
}
