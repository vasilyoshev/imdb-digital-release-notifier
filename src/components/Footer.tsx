/**
 * Compliance attribution (SPEC §12). TMDB requires the "not endorsed or
 * certified" notice wherever its data appears; JustWatch requires attribution
 * wherever provider data is shown. Reused compactly under the login card.
 * (The TMDB wordmark logo image lands with the settings/about slice.)
 */
export function AttributionLine() {
  return (
    <p className="text-xs leading-relaxed text-base-content/40">
      This product uses the{" "}
      <a
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noreferrer"
        className="link link-hover text-base-content/60"
      >
        TMDB
      </a>{" "}
      API but is not endorsed, certified, or otherwise approved by TMDB. Streaming availability by{" "}
      <a
        href="https://www.justwatch.com/"
        target="_blank"
        rel="noreferrer"
        className="link link-hover text-base-content/60"
      >
        JustWatch
      </a>
      .
    </p>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-base-300 bg-base-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <AttributionLine />
        <a
          href="stremio://release-notifier.netlify.app/manifest.json"
          className="btn btn-sm btn-outline shrink-0 gap-2"
          title="Install the Digital Release Radar catalogs in Stremio"
        >
          <span aria-hidden>🎬</span> Add to Stremio
        </a>
      </div>
    </footer>
  );
}
