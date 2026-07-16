/**
 * PROTOTYPE (ticket #43) — Detail Variant C "Takeover".
 * A full-screen page with a blurred poster hero — the movie gets the whole
 * canvas, back arrow returns to the radar. Most cinematic, most navigation.
 */
import type { RadarMovie, Region } from "../radar/data";
import { TMDB_IMG } from "../radar/data";
import { RadarPoster } from "../radar/bits";
import { FollowButton, MetaLine, Overview, RegionDates, TrailerSlot, WhereToWatch } from "./pieces";

export const NAME = "Takeover";

export function DetailC({
  movie,
  region,
  onClose,
}: {
  movie: RadarMovie;
  region: Region;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-base-200">
      <div className="relative">
        {movie.posterPath && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-25 blur-xl"
            style={{ backgroundImage: `url(${TMDB_IMG}${movie.posterPath})` }}
          />
        )}
        <div className="relative mx-auto max-w-4xl px-4 pt-6 pb-10">
          <button className="btn btn-ghost btn-sm mb-4" onClick={onClose}>
            ← Back to radar
          </button>
          <div className="flex flex-col gap-6 sm:flex-row">
            <RadarPoster movie={movie} className="w-44 shrink-0 self-start shadow-2xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <h1 className="text-3xl leading-tight font-semibold">{movie.title}</h1>
              <MetaLine movie={movie} />
              <Overview movie={movie} />
              <div className="flex items-center gap-3">
                <FollowButton />
                <span className="text-xs opacity-50">Sign in to get pushed on release day</span>
              </div>
              <WhereToWatch movie={movie} region={region} />
            </div>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="card border border-base-300 bg-base-100/80 shadow-sm">
              <div className="card-body p-4">
                <h4 className="font-mono text-[10px] uppercase tracking-wide opacity-60">
                  Release dates
                </h4>
                <RegionDates movie={movie} region={region} />
              </div>
            </div>
            <div>
              <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wide opacity-60">Trailer</h4>
              <TrailerSlot />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
