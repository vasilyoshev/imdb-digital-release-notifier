/**
 * PROTOTYPE (ticket #43) — Detail Variant A "Modal".
 * A centered dialog over the dimmed table: poster left, facts right,
 * trailer at the bottom. Classic, symmetric, focus-stealing.
 */
import type { RadarMovie, Region } from "../radar/data";
import { RadarPoster } from "../radar/bits";
import { FollowButton, MetaLine, Overview, RegionDates, TrailerSlot, WhereToWatch } from "./pieces";

export const NAME = "Modal";

export function DetailA({
  movie,
  region,
  onClose,
}: {
  movie: RadarMovie;
  region: Region;
  onClose: () => void;
}) {
  return (
    <div className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-xs btn-circle absolute top-2 right-2" onClick={onClose}>
          ✕
        </button>
        <div className="flex gap-4">
          <RadarPoster movie={movie} className="w-32 shrink-0 self-start" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="text-lg leading-tight font-semibold">{movie.title}</h3>
            <MetaLine movie={movie} />
            <Overview movie={movie} />
            <WhereToWatch movie={movie} region={region} />
            <div className="mt-1">
              <FollowButton />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wide opacity-60">
              Release dates
            </h4>
            <RegionDates movie={movie} region={region} />
          </div>
          <div>
            <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wide opacity-60">Trailer</h4>
            <TrailerSlot />
          </div>
        </div>
      </div>
    </div>
  );
}
