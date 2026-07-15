// PROTOTYPE — tiny shared atoms (poster placeholder, status badge, provider
// chip). Each variant keeps its own layout; only these leaf bits are shared.
import { DerivedStatus, Movie, Provider } from "./mock-data";

export const STATUS_BADGE: Record<DerivedStatus, string> = {
  Unmatched: "badge-ghost",
  Waiting: "badge-neutral",
  Announced: "badge-info",
  "In theaters": "badge-warning",
  "Out now": "badge-success",
};

export const StatusBadge = ({
  status,
  size = "badge-sm",
}: {
  status: DerivedStatus;
  size?: string;
}) => (
  <span className={`badge ${size} ${STATUS_BADGE[status]} whitespace-nowrap`}>
    {status}
  </span>
);

/** Poster placeholder — gradient + initials, no external images. */
export const Poster = ({
  movie,
  className = "",
}: {
  movie: Movie;
  className?: string;
}) => {
  const initials = movie.title
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <div
      className={`flex items-center justify-center rounded text-white/80 font-bold select-none ${className}`}
      style={{
        aspectRatio: "2/3",
        background: `linear-gradient(160deg, hsl(${movie.hue} 45% 38%), hsl(${(movie.hue + 40) % 360} 55% 18%))`,
      }}
    >
      {initials}
    </div>
  );
};

const KIND_LABEL: Record<Provider["kind"], string> = {
  stream: "stream",
  rent: "rent",
  buy: "buy",
};

const KIND_CLASS: Record<Provider["kind"], string> = {
  stream: "badge-primary badge-outline",
  rent: "badge-secondary badge-outline",
  buy: "badge-accent badge-outline",
};

export const ProviderChip = ({ provider }: { provider: Provider }) => (
  <span className={`badge badge-sm ${KIND_CLASS[provider.kind]} whitespace-nowrap`}>
    {provider.name} · {KIND_LABEL[provider.kind]}
  </span>
);
