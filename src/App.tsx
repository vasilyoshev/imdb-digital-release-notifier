import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

/**
 * The route guard (SPEC §10). One account, one decision: while the session is
 * resolving show a spinner; then render the app shell if signed in, otherwise
 * the login screen. No router — the app is a single authenticated page.
 */
export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <span className="loading loading-dots loading-lg text-primary" />
      </div>
    );
  }

  return session ? <AppShell /> : <LoginScreen />;
}
