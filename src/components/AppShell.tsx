import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { useSupportedRegions } from "../lib/queries";
import { loadRegion, saveRegion } from "../lib/region";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { InstallBanner } from "./InstallBanner";
import { Dashboard } from "./dashboard/Dashboard";
import { SettingsModal } from "./dashboard/SettingsModal";

/**
 * The Console frame for everyone (SPEC §4, §10). Anonymous visitors get the
 * public Digital Release Radar; signed-in users get the full switcher. The
 * active radar region lives here so the navbar select and the radar view share
 * it, defaulted from the browser locale and persisted per device.
 */
export function AppShell({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const regions = useSupportedRegions();
  const supported = regions.data?.map((r) => r.region) ?? [];
  const [region, setRegion] = useState("US");

  // Resolve the stored/locale region once the supported set loads.
  useEffect(() => {
    if (supported.length) setRegion(loadRegion(supported));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions.data]);

  const changeRegion = (r: string) => {
    setRegion(r);
    saveRegion(r);
  };

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <InstallBanner />
      <Navbar
        onOpenSettings={() => setSettingsOpen(true)}
        onSignIn={onSignIn}
        region={region}
        onRegionChange={changeRegion}
        regions={regions.data ?? []}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Dashboard region={region} />
      </main>
      <Footer />
      {user && <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
