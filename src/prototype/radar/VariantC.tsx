/**
 * PROTOTYPE (ticket #42) — Variant C "Marquee rows".
 * Streaming-service browse: poster-first horizontal rows (new this week /
 * coming soon / by provider), date ribbons on the posters, minimal top bar,
 * sticky signup bar pinned to the bottom. The table is gone entirely.
 */
import { Mark } from "../../components/Mark";
import { bucketFor, daysUntil, fmtShort, type RadarMovie, type Region } from "./data";
import { Attribution, RadarPoster, RegionSelect } from "./bits";

export const NAME = "Marquee rows";

function Row({ title, accent, movies, ribbon }: {
  title: string;
  accent: string;
  movies: RadarMovie[];
  ribbon: (m: RadarMovie) => string;
}) {
  if (!movies.length) return null;
  return (
    <section className="mb-8">
      <h2 className={`mb-3 px-4 font-mono text-sm uppercase tracking-widest ${accent}`}>{title}</h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2">
        {movies.map((m) => (
          <div key={m.id} className="w-32 shrink-0">
            <div className="relative">
              <RadarPoster movie={m} className="w-32" />
              <span className="badge badge-sm absolute bottom-1 left-1 border-none bg-black/80 font-mono text-primary">
                {ribbon(m)}
              </span>
            </div>
            <div className="mt-1 truncate text-xs" title={m.title}>{m.title}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function VariantC({ region, onRegion }: { region: Region; onRegion: (r: Region) => void }) {
  const { recent, upcoming } = bucketFor(region);
  const byStream = (name: string) =>
    [...recent, ...upcoming].filter((m) => m.providers.some((p) => p.kind === "stream" && p.name === name));

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2">
          <Mark className="h-6 w-6 text-primary" />
          <span className="wordmark text-2xl">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
        </span>
        <RegionSelect region={region} onChange={onRegion} className="w-20" />
      </header>

      <main className="flex-1 pb-24">
        <Row
          title={`New on digital · ${region}`}
          accent="text-success"
          movies={recent}
          ribbon={(m) => fmtShort(m.digital[region]!)}
        />
        <Row
          title="Coming soon to digital"
          accent="text-info"
          movies={upcoming}
          ribbon={(m) => `in ${daysUntil(m.digital[region]!)}d`}
        />
        <Row
          title="New & next on Netflix"
          accent="text-primary"
          movies={byStream("Netflix")}
          ribbon={(m) => fmtShort(m.digital[region]!)}
        />
        <Row
          title="New & next on Prime Video"
          accent="text-primary"
          movies={byStream("Prime Video")}
          ribbon={(m) => fmtShort(m.digital[region]!)}
        />
        <Attribution />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-base-300 bg-base-100/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <span className="text-sm opacity-80">
            <span className="font-medium text-base-content">Never miss a drop.</span>{" "}
            Follow your watchlist, get pushed on release day.
          </span>
          <span className="flex shrink-0 gap-2">
            <button className="btn btn-ghost btn-sm">Sign in</button>
            <button className="btn btn-primary btn-sm">Sign up free</button>
          </span>
        </div>
      </div>
    </div>
  );
}
