import { fmtFull, toProviders, todayISO } from "../../lib/dashboard";
import { useMovieDetail } from "../../lib/queries";
import { ProviderChip } from "./atoms";

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

/**
 * The movie detail side panel (SPEC §10, prototype Variant B): a right-hand
 * drawer over the still-clickable table on desktop, a full-screen sheet on
 * phones. Reads global tables only, so it works signed out too — the Follow
 * button becomes the sign-in funnel for anonymous visitors.
 */
export function MovieDetailPanel({
  movieId,
  onClose,
  activeRegion,
  isAuthenticated,
}: {
  movieId: number | null;
  onClose: () => void;
  activeRegion: string;
  isAuthenticated: boolean;
}) {
  const detail = useMovieDetail(movieId);
  if (movieId == null) return null;
  const m = detail.data;

  return (
    <>
      {/* Backdrop on phones only — desktop keeps the table clickable behind. */}
      <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Movie details"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-none flex-col border-l border-base-300 bg-base-100 shadow-2xl sm:max-w-sm"
      >
        <header className="flex items-start gap-3 border-b border-base-300 p-4">
          {m?.posterPath ? (
            <img
              src={`${TMDB_IMG}${m.posterPath}`}
              alt=""
              className="w-16 shrink-0 rounded object-cover"
              style={{ aspectRatio: "2/3" }}
            />
          ) : (
            <div className="w-16 shrink-0 rounded bg-base-300" style={{ aspectRatio: "2/3" }} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-tight font-semibold">{m?.title ?? "…"}</h2>
            {m?.year != null && <p className="text-sm opacity-60">{m.year}</p>}
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {detail.isError ? (
            <div role="alert" className="alert alert-error">
              <span>Couldn&apos;t load details.</span>
            </div>
          ) : detail.isLoading || !m ? (
            <div className="grid place-items-center py-16">
              <span className="loading loading-dots loading-lg text-primary" />
            </div>
          ) : (
            <>
              {m.overview ? (
                <p className="text-sm leading-relaxed opacity-90">{m.overview}</p>
              ) : (
                <p className="text-sm opacity-40">No synopsis yet.</p>
              )}

              {m.trailerKey && (
                <div className="aspect-video w-full overflow-hidden rounded-lg border border-base-300">
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${m.trailerKey}`}
                    title="Trailer"
                    allow="accelerometer; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              <DateMatrix
                releaseDates={m.releaseDates}
                activeRegion={activeRegion}
              />

              <Providers rawProviders={m.rawProviders} activeRegion={activeRegion} />

              {isAuthenticated ? (
                <button className="btn btn-primary btn-block" disabled>
                  Follow — coming soon
                </button>
              ) : (
                <button className="btn btn-primary btn-block" onClick={onClose}>
                  Sign in to follow
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function DateMatrix({
  releaseDates,
  activeRegion,
}: {
  releaseDates: { region: string; medium: "theatrical" | "digital"; releaseDate: string }[];
  activeRegion: string;
}) {
  const today = todayISO();
  const byRegion = new Map<string, { theatrical?: string; digital?: string }>();
  for (const rd of releaseDates) {
    const row = byRegion.get(rd.region) ?? {};
    row[rd.medium] = rd.releaseDate;
    byRegion.set(rd.region, row);
  }
  // Active region first, then the rest alphabetically.
  const regions = [...byRegion.keys()].sort((a, b) =>
    a === activeRegion ? -1 : b === activeRegion ? 1 : a.localeCompare(b),
  );

  if (regions.length === 0) {
    return <p className="text-sm opacity-40">No regional release dates yet.</p>;
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase opacity-50">Release dates</h3>
      <div className="overflow-x-auto rounded-lg border border-base-300">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Region</th>
              <th>Theatrical</th>
              <th>Digital</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => {
              const row = byRegion.get(region)!;
              return (
                <tr key={region} className={region === activeRegion ? "font-medium" : ""}>
                  <td>{region}</td>
                  <td className="font-mono text-xs">{row.theatrical ? fmtFull(row.theatrical) : "—"}</td>
                  <td className="font-mono text-xs">
                    {row.digital ? (
                      <span className="flex items-center gap-1">
                        {fmtFull(row.digital)}
                        <span className={`badge badge-xs ${row.digital <= today ? "badge-success" : "badge-info"}`}>
                          {row.digital <= today ? "out now" : "upcoming"}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Providers({
  rawProviders,
  activeRegion,
}: {
  rawProviders: { region: string; provider_name: string; offer_type: string; display_priority: number | null }[];
  activeRegion: string;
}) {
  const providers = toProviders(rawProviders, activeRegion);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase opacity-50">
        Where to watch ({activeRegion})
      </h3>
      {providers.length === 0 ? (
        <p className="text-sm opacity-40">Not streaming in {activeRegion} yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {providers.map((p) => (
            <ProviderChip key={`${p.name}-${p.kind}`} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}
