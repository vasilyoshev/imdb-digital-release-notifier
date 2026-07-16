import { useState } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { InstallBanner } from "./InstallBanner";
import { Dashboard } from "./dashboard/Dashboard";
import { SettingsModal } from "./dashboard/SettingsModal";

/**
 * The authenticated frame the dashboard, side rail, and settings modal slot
 * into (SPEC §9). Dashboard + rail are live; the gear opens settings and the
 * navbar drives Refresh-now.
 */
export function AppShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <InstallBanner />
      <Navbar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Dashboard />
      </main>
      <Footer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
