import {
  effectiveRating,
  fmtFull,
  fmtVotes,
  PROVIDER_KIND_CLASS,
  STATUS_BADGE,
  type DerivedStatus,
  type Movie,
  type Provider,
} from "../../lib/dashboard";

const TMDB_IMG = "https://image.tmdb.org/t/p/w92";

/** Poster thumbnail: the real TMDb image, or a deterministic initials tile
 *  when a movie has no poster yet (unmatched / not-refreshed). */
export function Poster({ movie, className = "" }: { movie: Movie; className?: string }) {
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
  const hue = ((movie.id * 47) % 360 + 360) % 360;
  const initials = (movie.title ?? "?")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div
      className={`flex items-center justify-center rounded font-bold text-white/80 select-none ${className}`}
      style={{
        aspectRatio: "2/3",
        background: `linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 55% 18%))`,
      }}
    >
      {initials || "?"}
    </div>
  );
}

export function StatusBadge({
  status,
  size = "badge-sm",
}: {
  status: DerivedStatus;
  size?: string;
}) {
  return (
    <span className={`badge ${size} ${STATUS_BADGE[status]} whitespace-nowrap`}>
      {status}
    </span>
  );
}

/** Score + vote count — IMDb when available, else TMDB (shown in the tooltip). */
export function RatingCell({ movie }: { movie: Movie }) {
  const r = effectiveRating(movie);
  if (!r) return <span className="opacity-40">—</span>;
  return (
    <span className="whitespace-nowrap" title={`${r.source} rating`}>
      <span className="text-amber-400">★</span> {r.score.toFixed(1)}
      {r.votes > 0 && <span className="ml-1 text-xs opacity-50">{fmtVotes(r.votes)}</span>}
    </span>
  );
}

export function ProviderChip({ provider }: { provider: Provider }) {
  return (
    <span
      className={`badge badge-sm ${PROVIDER_KIND_CLASS[provider.kind]} whitespace-nowrap`}
    >
      {provider.name} · {provider.kind}
    </span>
  );
}

/** An effective date with its sourcing region as a superscript, or a dash. */
export function DateCell({
  date,
  region,
}: {
  date: string | null;
  region: string | null;
}) {
  if (!date) return <span className="opacity-40">—</span>;
  return (
    <span className="whitespace-nowrap font-mono text-xs">
      {fmtFull(date)} <sup className="opacity-50">{region}</sup>
    </span>
  );
}
