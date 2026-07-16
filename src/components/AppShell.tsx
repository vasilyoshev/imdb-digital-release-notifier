import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { Dashboard } from "./dashboard/Dashboard";

/**
 * The authenticated frame the dashboard, side rail, and settings modal slot
 * into (SPEC §9). The dashboard (list switcher · stat-strip · movie table) is
 * live; the Upcoming/History rail (#33) and settings (#34) fill in next.
 */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Dashboard />
      </main>
      <Footer />
    </div>
  );
}
