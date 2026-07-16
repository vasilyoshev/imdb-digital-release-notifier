/** PROTOTYPE (ticket #43) — shared content atoms for the detail variants.
 *  Layout stays per-variant; only leaf blocks live here. */
import { fmtFull, REGIONS, TODAY, type RadarMovie, type Region } from "../radar/data";
import { ProviderChips } from "../radar/bits";

/** Cross-region date matrix: one row per region, digital + status glyph. */
export function RegionDates({ movie, region }: { movie: RadarMovie; region: Region }) {
  return (
    <table className="table table-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide">
          <th>Region</th>
          <th>Digital</th>
          <th></th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {REGIONS.map((r) => {
          const d = movie.digital[r];
          return (
            <tr key={r} className={r === region ? "text-primary" : ""}>
              <td>{r}{r === region ? " ◂" : ""}</td>
              <td>{d ? fmtFull(d) : "—"}</td>
              <td className="opacity-60">{!d ? "unknown" : d <= TODAY ? "out now" : "upcoming"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MetaLine({ movie }: { movie: RadarMovie }) {
  return (
    <p className="font-mono text-xs opacity-60">
      {movie.year}
      {movie.runtime ? ` · ${movie.runtime} min` : ""}
      {movie.genres?.length ? ` · ${movie.genres.join(" / ")}` : ""}
    </p>
  );
}

export function Overview({ movie }: { movie: RadarMovie }) {
  return (
    <p className="text-sm opacity-80">
      {movie.overview ?? "Plot details for this title haven't been synced yet."}
    </p>
  );
}

export function WhereToWatch({ movie, region }: { movie: RadarMovie; region: Region }) {
  return (
    <div>
      <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wide opacity-60">
        Where to watch · {region}
      </h4>
      <ProviderChips providers={movie.providers} max={6} />
    </div>
  );
}

/** Fake trailer slot — a 16:9 block with a play affordance. */
export function TrailerSlot({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid place-items-center rounded-box border border-base-300 bg-black/60 ${className}`}
      style={{ aspectRatio: "16/9" }}
    >
      <span className="btn btn-circle btn-primary btn-sm">▶</span>
    </div>
  );
}

export function FollowButton({ block = false }: { block?: boolean }) {
  return (
    <button
      className={`btn btn-primary btn-sm ${block ? "btn-block" : ""}`}
      title="Sign in to follow this movie"
    >
      + Follow
    </button>
  );
}
