import { useEffect, useState } from "react";
import { useOnboard, useSupportedRegions } from "../lib/queries";

/**
 * The first-run onboarding wizard (SPEC §3): two light steps — confirm the region
 * cascade + timezone (prefilled from the browser), then optionally import an IMDb
 * watchlist. No push prompt here; that stays in settings/detail context. On finish
 * the profile flips to onboarded and the Console (Radar tab) is revealed behind.
 */
export function OnboardingWizard() {
  const regions = useSupportedRegions();
  const onboard = useOnboard();

  const browserTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();
  const browserRegion = (navigator.language || "en-US").split("-")[1]?.toUpperCase();

  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [timezone, setTimezone] = useState(browserTz);
  const [watchlistUrl, setWatchlistUrl] = useState("");
  const [seeded, setSeeded] = useState(false);

  const supported = regions.data ?? [];
  // Prefill the region picker once the supported set loads (browser region + US).
  useEffect(() => {
    if (seeded || !supported.length) return;
    const init = new Set<string>();
    if (browserRegion && supported.some((r) => r.region === browserRegion)) init.add(browserRegion);
    if (supported.some((r) => r.region === "US")) init.add("US");
    setPicked(init);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported.length, seeded]);

  const toggle = (region: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });

  // Cascade order follows the supported-region priority order.
  const cascade = supported.map((r) => r.region).filter((r) => picked.has(r));

  const finish = (imdbUserId: string | null) =>
    onboard.mutate({ regionCascade: cascade, timezone, imdbUserId });

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <div className="mb-4 flex items-center gap-2">
          <ul className="steps flex-1 text-xs">
            <li className={`step ${step >= 1 ? "step-primary" : ""}`}>Regions</li>
            <li className={`step ${step >= 2 ? "step-primary" : ""}`}>Watchlist</li>
          </ul>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Where do you watch?</h2>
              <p className="text-sm text-base-content/60">
                Pick the regions you care about — release dates and providers follow this order.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {supported.map((r) => (
                <button
                  key={r.region}
                  type="button"
                  onClick={() => toggle(r.region)}
                  className={`btn btn-sm ${picked.has(r.region) ? "btn-primary" : "btn-outline"}`}
                >
                  {r.region} · {r.name}
                </button>
              ))}
            </div>
            <label className="form-control">
              <span className="mb-1 text-xs font-medium text-base-content/60">Timezone (for your alert time)</span>
              <input
                className="input input-bordered"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
            <div className="modal-action">
              <button
                className="btn btn-primary"
                disabled={cascade.length === 0}
                onClick={() => setStep(2)}
              >
                Next
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Import your IMDb watchlist?</h2>
              <p className="text-sm text-base-content/60">
                Paste your IMDb profile or watchlist URL to sync it — or just follow movies from the Radar.
              </p>
            </div>
            <input
              className="input input-bordered w-full"
              placeholder="https://www.imdb.com/user/ur…/watchlist"
              value={watchlistUrl}
              onChange={(e) => setWatchlistUrl(e.target.value)}
            />
            {onboard.isError && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{(onboard.error as Error).message}</span>
              </div>
            )}
            <div className="modal-action justify-between">
              <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={onboard.isPending}>
                Back
              </button>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => finish(null)}
                  disabled={onboard.isPending}
                >
                  Skip
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => finish(watchlistUrl.trim() || null)}
                  disabled={onboard.isPending}
                >
                  {onboard.isPending && <span className="loading loading-spinner loading-xs" />}
                  Finish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
