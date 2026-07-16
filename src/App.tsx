import { lazy, Suspense } from "react";
import { useAuth } from "./lib/auth-context";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

// PROTOTYPE (tickets #42/#43): dev-only ?prototype= mounts. Delete with src/prototype.
const RadarPrototype = import.meta.env.DEV
  ? lazy(() => import("./prototype/radar/RadarPrototype"))
  : null;
const DetailPrototype = import.meta.env.DEV
  ? lazy(() => import("./prototype/detail/DetailPrototype"))
  : null;

/**
 * The route guard (SPEC §10). One account, one decision: while the session is
 * resolving show a spinner; then render the app shell if signed in, otherwise
 * the login screen. No router — the app is a single authenticated page.
 */
export default function App() {
  const { session, loading } = useAuth();

  const proto = new URLSearchParams(window.location.search).get("prototype");
  if (RadarPrototype && proto === "radar") {
    return (
      <Suspense fallback={null}>
        <RadarPrototype />
      </Suspense>
    );
  }
  if (DetailPrototype && proto === "detail") {
    return (
      <Suspense fallback={null}>
        <DetailPrototype />
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-base-200">
        <span className="loading loading-dots loading-lg text-primary" />
      </div>
    );
  }

  return session ? <AppShell /> : <LoginScreen />;
}
