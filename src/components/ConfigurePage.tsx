import { useEffect, useState } from "react";
import { STATUS_ORDER } from "../lib/dashboard";
import type { SortKey } from "../lib/table-controls";
import { useLists, useSupportedRegions } from "../lib/queries";
import {
  type CatalogDef,
  type CatalogSortKey,
  decodeCatalogs,
  defaultCatalogs,
  encodeCatalogs,
  isRadarSource,
  newCatalogId,
  parseCatalogs,
  RADAR_CATALOGS,
  useCreateStremioConfig,
  useRegenerateStremioToken,
  useStremioConfig,
  useUpdateStremioConfig,
} from "../lib/stremio";
import { Mark } from "./Mark";
import { AttributionLine } from "./Footer";

const SORT_LABELS: Record<CatalogSortKey, string> = {
  rank: "Curated rank",
  digital: "Digital date",
  theatrical: "Theatrical date",
  added: "Date added",
  rating: "Rating",
  popularity: "Popularity",
  year: "Year",
  title: "Title",
  status: "Status",
};
const LIST_SORT_KEYS = (Object.keys(SORT_LABELS) as CatalogSortKey[]).filter(
  (k): k is SortKey => k !== "rank",
);
// Radar rows arrive curated, so "rank" leads and is the default there.
const RADAR_SORT_KEYS: CatalogSortKey[] = ["rank", ...LIST_SORT_KEYS];

const VOTE_PRESETS: { label: string; value: number | null }[] = [
  { label: "Any popularity", value: null },
  { label: "1k+ votes", value: 1000 },
  { label: "10k+ votes", value: 10000 },
  { label: "100k+ votes", value: 100000 },
];

/** An anonymous visitor's starting point, or whatever their link already
 * encodes — radar catalogs only, since lists need an account (#118). */
function seedAnonCatalogs(): CatalogDef[] {
  const match = /^\/c\/([^/]+)\/configure\/?$/.exec(window.location.pathname);
  return match ? decodeCatalogs(match[1]) : defaultCatalogs([]);
}

/**
 * The Stremio configure/install page (map #109) — the target of /configure and
 * of Stremio's Configure button (/{token}/configure, /c/{config}/configure).
 *
 * Two modes. **Signed in**: catalogs may draw on the user's lists, live in the
 * DB, and install under a personal token, so edits reach an installed addon
 * without a new link. **Anonymous** (#118): radar catalogs only, held in
 * component state and encoded into the install URL itself — no account, no
 * token, nothing stored, so each edit produces a new link to install.
 */
export function ConfigurePage({
  anonymous = false,
  onSignIn,
}: {
  anonymous?: boolean;
  onSignIn?: () => void;
}) {
  const cfgQuery = useStremioConfig(!anonymous);
  const lists = useLists(!anonymous);
  const regions = useSupportedRegions();
  const create = useCreateStremioConfig();
  const update = useUpdateStremioConfig();
  const regen = useRegenerateStremioToken();
  const [anonCatalogs, setAnonCatalogs] = useState<CatalogDef[]>(seedAnonCatalogs);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Lazy provisioning: a signed-in user's first visit creates their row (and
  // its token). Anonymous visitors never get one.
  useEffect(() => {
    if (!anonymous && cfgQuery.isSuccess && cfgQuery.data === null && create.isIdle) {
      create.mutate();
    }
  }, [anonymous, cfgQuery.isSuccess, cfgQuery.data, create]);

  const row = cfgQuery.data;
  // The resolved catalog array — the same resolution the Worker applies, so the
  // page always shows exactly what the addon will serve.
  const catalogs = anonymous
    ? anonCatalogs
    : row && lists.data
      ? parseCatalogs(row.config, lists.data)
      : [];

  const save = (next: CatalogDef[]) => {
    if (anonymous) setAnonCatalogs(next);
    else update.mutate({ ...(row?.config ?? {}), catalogs: next });
  };
  const patchAt = (i: number, patch: Partial<CatalogDef>) =>
    save(catalogs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeAt = (i: number) => save(catalogs.filter((_, j) => j !== i));
  const addCatalog = () => {
    const firstList = anonymous ? undefined : lists.data?.[0];
    const source = firstList ? `list-${firstList.id}` : RADAR_CATALOGS[0].id;
    save([
      ...catalogs,
      {
        id: newCatalogId(),
        name: "New catalog",
        source,
        enabled: true,
        sort: { key: isRadarSource(source) ? "rank" : "digital", dir: "desc" },
        minVotes: null,
        status: null,
        region: "US",
      },
    ]);
  };

  // Anonymous installs carry their whole config in the path; signed-in ones
  // carry a token and read the config server-side.
  const installPath = anonymous
    ? `/c/${encodeCatalogs(catalogs)}/manifest.json`
    : row
      ? `/${row.token}/manifest.json`
      : null;
  const manifestUrl = installPath ? `${window.location.origin}${installPath}` : null;
  const deepLink = installPath ? `stremio://${window.location.host}${installPath}` : null;
  const webInstall = manifestUrl
    ? `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`
    : null;

  async function copyUrl() {
    if (!manifestUrl) return;
    await navigator.clipboard.writeText(manifestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sourceOptions = [
    ...(anonymous ? [] : lists.data ?? []).map((l) => ({
      value: `list-${l.id}`,
      label: l.kind === "imdb_watchlist" ? `${l.name} (IMDb watchlist)` : `${l.name} (list)`,
    })),
    ...RADAR_CATALOGS.map((c) => ({ value: c.id, label: `${c.name} (radar)` })),
  ];

  const loading = anonymous ? false : cfgQuery.isLoading || lists.isLoading || !row;

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
        <div className="flex flex-1 items-center gap-2">
          <Mark className="h-6 w-6 text-primary" />
          <span className="wordmark hidden text-2xl sm:inline">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
          <span className="badge badge-ghost ml-1 font-mono text-xs">Stremio addon</span>
        </div>
        {anonymous ? (
          <button className="btn btn-primary btn-sm" onClick={() => onSignIn?.()}>
            Sign in
          </button>
        ) : (
          <a href="/" className="btn btn-ghost btn-sm">
            ← Back to Console
          </a>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <span className="loading loading-dots loading-lg text-primary" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Install */}
            <section className="card border border-base-300 bg-base-100 shadow">
              <div className="card-body gap-3 p-4 sm:p-6">
                <h2 className="card-title text-base">🎬 Install in Stremio</h2>
                <p className="text-sm text-base-content/60">
                  {anonymous
                    ? "Set the catalogs up below, then install — no account needed. Your choices live in the link itself, so change them any time and install the new link."
                    : "Your personal addon link — it serves the catalogs below, filtered and sorted your way. Keep it to yourself: anyone with the link can see what's on your lists."}
                </p>
                <div className="join w-full">
                  <input
                    readOnly
                    className="input input-sm input-bordered join-item w-full font-mono text-xs"
                    value={manifestUrl ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Manifest URL"
                  />
                  <button className="btn btn-sm join-item" onClick={() => void copyUrl()}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a className="btn btn-primary btn-sm" href={deepLink ?? "#"}>
                    Install / reinstall in Stremio
                  </a>
                  <a
                    className="btn btn-outline btn-sm"
                    href={webInstall ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Stremio Web
                  </a>
                  {!anonymous && (
                    <button
                      className="btn btn-ghost btn-sm text-error"
                      onClick={() => setConfirmRegen(true)}
                    >
                      Regenerate link…
                    </button>
                  )}
                </div>
                <p className="text-xs text-base-content/50">
                  Already installed? Use the same button to reinstall — that&apos;s how
                  Stremio picks up catalogs you&apos;ve added, removed, or renamed. In
                  Stremio Web you may need to Uninstall first.
                </p>
              </div>
            </section>

            {anonymous && (
              <div className="alert border border-base-300 bg-base-100 py-3 text-sm">
                <span>
                  <span className="font-medium">Want your own watchlist in Stremio?</span>{" "}
                  Sign in to add catalogs built from your IMDb watchlist and the films you
                  follow — those stay private to your account and get a personal link whose
                  edits apply without reinstalling.
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => onSignIn?.()}>
                  Sign in
                </button>
              </div>
            )}

            {/* Catalogs */}
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
                  Catalogs
                </h2>
                <p className="mt-1 text-xs text-base-content/50">
                  Each catalog is its own row in Stremio: pick a source, then filter and sort
                  it any way — the same source can appear in several catalogs with different
                  filters.
                </p>
                <p className="mt-2 text-xs text-base-content/50">
                  {anonymous ? (
                    <>
                      Because there&apos;s no account, every change here produces a{" "}
                      <span className="font-medium text-base-content/70">new link</span> —
                      install it again to apply. Sign in if you&apos;d rather edit in place.
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-base-content/70">
                        Filter and sort edits
                      </span>{" "}
                      apply to an installed addon on their own, though Stremio caches catalog
                      rows and can take a while to show them.{" "}
                      <span className="font-medium text-base-content/70">
                        Adding, removing, renaming, or toggling a catalog
                      </span>{" "}
                      changes the addon itself — Stremio keeps the catalog list it saw at
                      install time, so{" "}
                      <span className="font-medium text-base-content/70">reinstall</span>{" "}
                      (button above) to apply those.
                    </>
                  )}
                </p>
              </div>

              {catalogs.map((c, i) => (
                <CatalogCard
                  key={c.id}
                  def={c}
                  sourceOptions={sourceOptions}
                  regions={regions.data ?? []}
                  onPatch={(patch) => patchAt(i, patch)}
                  onRemove={() => removeAt(i)}
                />
              ))}

              <button className="btn btn-outline btn-sm self-start" onClick={addCatalog}>
                + Add catalog
              </button>
            </section>

            {update.isError && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>Saving failed: {(update.error as Error).message}</span>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-base-300 bg-base-100">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <AttributionLine />
        </div>
      </footer>

      {confirmRegen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-semibold">Regenerate your addon link?</h3>
            <p className="py-2 text-sm text-base-content/70">
              Stremio identifies addons by their URL, so your current install becomes a dead
              copy — it will show empty catalogs until you remove it. After regenerating:
              uninstall the old addon in Stremio, then install again with the new link.
            </p>
            {regen.isError && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{(regen.error as Error).message}</span>
              </div>
            )}
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmRegen(false)}
                disabled={regen.isPending}
              >
                Cancel
              </button>
              <button
                className="btn btn-error"
                disabled={regen.isPending}
                onClick={() =>
                  regen.mutate(undefined, { onSuccess: () => setConfirmRegen(false) })
                }
              >
                {regen.isPending && <span className="loading loading-spinner loading-xs" />}
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogCard({
  def,
  sourceOptions,
  regions,
  onPatch,
  onRemove,
}: {
  def: CatalogDef;
  sourceOptions: { value: string; label: string }[];
  regions: { region: string; name: string }[];
  onPatch: (patch: Partial<CatalogDef>) => void;
  onRemove: () => void;
}) {
  // Local draft for the name so typing doesn't fire a save per keystroke —
  // committed on blur/Enter.
  const [name, setName] = useState(def.name);
  useEffect(() => setName(def.name), [def.name]);
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== def.name) onPatch({ name: trimmed });
    else setName(def.name);
  };

  const radar = isRadarSource(def.source);
  const sortKeys = radar ? RADAR_SORT_KEYS : LIST_SORT_KEYS;

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input input-sm input-bordered w-40 grow font-medium sm:w-52 sm:grow-0"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Catalog name"
          />
          <select
            className="select select-sm select-bordered w-auto"
            value={def.source}
            onChange={(e) => {
              const source = e.target.value;
              // The sort vocabularies differ, so re-default when crossing kinds.
              const key: CatalogSortKey = isRadarSource(source) ? "rank" : "digital";
              onPatch({ source, sort: { key, dir: def.sort.dir } });
            }}
            aria-label="Catalog source"
          >
            {sourceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={def.enabled}
              onChange={(e) => onPatch({ enabled: e.target.checked })}
              aria-label={`Show ${def.name} in Stremio`}
            />
            <button
              className="btn btn-ghost btn-sm btn-circle text-error"
              onClick={onRemove}
              aria-label={`Remove ${def.name}`}
              title="Remove catalog"
            >
              ✕
            </button>
          </div>
        </div>

        {def.enabled && (
          <div className="flex flex-wrap gap-3">
            {radar && (
              <LabeledSelect
                label="Region"
                value={def.region}
                onChange={(region) => onPatch({ region })}
                options={regions.map((x) => ({
                  value: x.region,
                  label: `${x.region} — ${x.name}`,
                }))}
              />
            )}
            <LabeledSelect
              label="Sort"
              value={def.sort.key}
              onChange={(key) => onPatch({ sort: { ...def.sort, key: key as CatalogSortKey } })}
              options={sortKeys.map((k) => ({ value: k, label: SORT_LABELS[k] }))}
            />
            {def.sort.key !== "rank" && (
              <LabeledSelect
                label="Direction"
                value={def.sort.dir}
                onChange={(dir) => onPatch({ sort: { ...def.sort, dir: dir as "asc" | "desc" } })}
                options={[
                  { value: "desc", label: "Descending ↓" },
                  { value: "asc", label: "Ascending ↑" },
                ]}
              />
            )}
            <LabeledSelect
              label="Popularity"
              value={String(def.minVotes ?? "")}
              onChange={(v) => onPatch({ minVotes: v ? Number(v) : null })}
              options={VOTE_PRESETS.map((p) => ({
                value: String(p.value ?? ""),
                label: p.label,
              }))}
            />
            <LabeledSelect
              label="Status"
              value={def.status ?? ""}
              onChange={(v) => onPatch({ status: (v || null) as CatalogDef["status"] })}
              options={[
                { value: "", label: "All statuses" },
                ...STATUS_ORDER.map((s) => ({ value: s, label: s })),
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-base-content/60">{label}</span>
      <select
        className="select select-sm select-bordered w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
