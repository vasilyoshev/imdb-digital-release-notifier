import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Dismissible install prompt (SPEC §9). On Chromium the `beforeinstallprompt`
 * event drives a native Install button; on iOS (no such event) it shows the
 * Share → Add to Home Screen steps, which is the only way to install there
 * (and the only way iOS web push works).
 */
export function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;

  const iosNeedsSteps = isIos() && !deferred;
  if (!deferred && !iosNeedsSteps) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-base-300 bg-primary/10 px-4 py-2 text-sm">
      {iosNeedsSteps ? (
        <span>
          📲 Install: tap <span className="font-medium">Share</span> →{" "}
          <span className="font-medium">Add to Home Screen</span> to get push
          notifications.
        </span>
      ) : (
        <span>📲 Install this app to get push notifications on this device.</span>
      )}
      <div className="flex flex-none gap-2">
        {deferred && (
          <button className="btn btn-primary btn-xs" onClick={() => void install()}>
            Install
          </button>
        )}
        <button className="btn btn-ghost btn-xs" onClick={dismiss}>
          {iosNeedsSteps ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}
