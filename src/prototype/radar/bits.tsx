/** PROTOTYPE (ticket #42) — tiny shared pieces. Duplication over coupling. */
import { KIND_CLASS, REGIONS, TMDB_IMG, type RadarMovie, type RadarProvider, type Region } from "./data";

export function RadarPoster({ movie, className = "" }: { movie: RadarMovie; className?: string }) {
  if (movie.posterPath) {
    return (
      <img
        src={`${TMDB_IMG}${movie.posterPath}`}
        alt=""
        loading="lazy"
        className={`rounded object-cover ${className}`}
        style={{ aspectRatio: "2/3" }}
      />
    );
  }
  return (
    <div className={`grid place-items-center rounded bg-base-300 ${className}`} style={{ aspectRatio: "2/3" }}>
      ?
    </div>
  );
}

export function ProviderChips({ providers, max = 3 }: { providers: RadarProvider[]; max?: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      {providers.slice(0, max).map((p) => (
        <span key={p.name + p.kind} className={`badge badge-sm ${KIND_CLASS[p.kind]} whitespace-nowrap`}>
          {p.name} · {p.kind}
        </span>
      ))}
    </span>
  );
}

export function RegionSelect({
  region,
  onChange,
  className = "",
}: {
  region: Region;
  onChange: (r: Region) => void;
  className?: string;
}) {
  return (
    <select
      className={`select select-sm select-bordered font-mono ${className}`}
      value={region}
      onChange={(e) => onChange(e.target.value as Region)}
      aria-label="Region"
    >
      {REGIONS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

/** §12 attribution — mandatory on every public surface. */
export function Attribution() {
  return (
    <p className="px-4 py-3 text-center text-xs opacity-50">
      This product uses the TMDB API but is not endorsed, certified, or otherwise approved by TMDB.
      Watch-provider data by JustWatch.
    </p>
  );
}
