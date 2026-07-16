/**
 * PROTOTYPE (ticket #43) — Detail Variant B "Side panel".
 * A drawer sliding in from the right, table stays visible and clickable —
 * browse the radar and inspect movies without losing your place. Vertical
 * stack: poster banner, follow, facts, dates, trailer.
 */
import type { RadarMovie, Region } from "../radar/data";
import { TMDB_IMG } from "../radar/data";
import { FollowButton, MetaLine, Overview, RegionDates, TrailerSlot, WhereToWatch } from "./pieces";

export const NAME = "Side panel";

export function DetailB({
  movie,
  region,
  onClose,
}: {
  movie: RadarMovie;
  region: Region;
  onClose: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col overflow-y-auto border-l border-base-300 bg-base-100 shadow-2xl">
      <div
        className="relative h-40 shrink-0 bg-cover bg-center"
        style={
          movie.posterPath
            ? { backgroundImage: `url(${TMDB_IMG}${movie.posterPath})`, backgroundPosition: "center 20%" }
            : undefined
        }
      >
        <div className="absolute inset-0 bg-gradient-to-t from-base-100 to-base-100/20" />
        <button className="btn btn-ghost btn-xs btn-circle absolute top-2 right-2 bg-base-100/60" onClick={onClose}>
          ✕
        </button>
        <div className="absolute right-4 bottom-2 left-4">
          <h3 className="text-lg leading-tight font-semibold drop-shadow">{movie.title}</h3>
          <MetaLine movie={movie} />
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <FollowButton block />
        <Overview movie={movie} />
        <WhereToWatch movie={movie} region={region} />
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
    </aside>
  );
}
