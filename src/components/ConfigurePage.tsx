import { useEffect, useState } from "react";
import { STATUS_ORDER } from "../lib/dashboard";
import type { SortKey } from "../lib/table-controls";
import { useLists, useSupportedRegions } from "../lib/queries";
import {
  type CatalogDef,
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

const SORT_LABELS: Record<SortKey, string> = {
  digital: "Digital date",
  theatrical: "Theatrical date",
  added: "Date added",
  rating: "Rating",
  popularity: "Popularity",
  year: "Year",
  title: "Title",
  status: "Status",
};
const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

const VOTE_PRESETS: { label: string; value: number | null }[] = [
  { label: "Any popularity", value: null },
  { label: "1k+ votes", value: 1000 },
  { label: "10k+ votes", value: 10000 },
  { label: "100k+ votes", value: 100000 },
];

/**
 * The Stremio configure/install page (map #109, #113 + #116) — the target of
 * /configure and of Stremio's Configure button (/{token}/configure; the token
 * in the URL is ignored, edits are RLS-scoped to the signed-in user).
 *
 * The user manages an ORDERED LIST of custom catalogs — "Add catalog" appends
 * one; each card picks a source (a list or a radar window) and its own name,
 * sort, and filters. Two catalogs may share a source with different filters.
 * Every change saves the whole array immediately and reaches an installed
 * addon within ~5 minutes (the Worker's cache window).
 */
export function ConfigurePage() {
  const cfgQuery = useStremioConfig();
  const lists = useLists();
  const regions = useSupportedRegions();
  const create = useCreateStremioConfig();
  const update = useUpdateStremioConfig();
  const regen = useRegenerateStremioToken();
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Lazy provisioning: the first visit creates the row (and its token).
  useEffect(() => {
    if (cfgQuery.isSuccess && cfgQuery.data === null && create.isIdle) create.mutate();
  }, [cfgQuery.isSuccess, cfgQuery.data, create]);

  const row = cfgQuery.data;
  // The resolved catalog array — stored config when present, defaults otherwise
  // (same resolution the Worker applies, so the page shows exactly what the
  // addon serves). The first edit materializes the defaults into the config.
  const catalogs =
    row && lists.data ? parseCatalogs(row.config, lists.data) : [];

  const save = (next: CatalogDef[]) =>
    update.mutate({ ...(row?.config ?? {}), catalogs: next });
  const patchAt = (i: number, patch: Partial<CatalogDef>) =>
    save(catalogs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeAt = (i: number) => save(catalogs.filter((_, j) => j !== i));
  const addCatalog = () => {
    const firstList = lists.data?.[0];
    save([
      ...catalogs,
      {
        id: newCatalogId(),
        name: "New catalog",
        source: firstList ? `list-${firstList.id}` : RADAR_CATALOGS[0].id,
        enabled: true,
        sort: { key: "digital", dir: "desc" },
        minVotes: null,
        status: null,
        region: "US",
      },
    ]);
  };

  const manifestUrl = row ? `${window.location.origin}/${row.token}/manifest.json` : null;
  const deepLink = row ? `stremio://${window.location.host}/${row.token}/manifest.json` : null;
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
    ...(lists.data ?? []).map((l) => ({
      value: `list-${l.id}`,
      label: l.kind === "imdb_watchlist" ? `${l.name} (IMDb watchlist)` : `${l.name} (list)`,
    })),
    ...RADAR_CATALOGS.map((c) => ({ value: c.id, label: `${c.name} (radar)` })),
  ];

  const loading = cfgQuery.isLoading || lists.isLoading || !row;

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
        <a href="/" className="btn btn-ghost btn-sm">
          ← Back to Console
        </a>
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
                  Your personal addon link — it serves the catalogs below, filtered and sorted
                  your way. Keep it to yourself: anyone with the link can see what&apos;s on
                  your lists.
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
                  <button
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => setConfirmRegen(true)}
                  >
                    Regenerate link…
                  </button>
                </div>
                <p className="text-xs text-base-content/50">
                  Already installed? Use the same button to reinstall — that&apos;s how
                  Stremio picks up catalogs you&apos;ve added, removed, or renamed. In
                  Stremio Web you may need to Uninstall first.
                </p>
              </div>
            </section>

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
                  <span className="font-medium text-base-content/70">Filter and sort edits</span>{" "}
                  apply to an installed addon on their own, though Stremio caches catalog rows
                  and can take a while to show them.{" "}
                  <span className="font-medium text-base-content/70">
                    Adding, removing, renaming, or toggling a catalog
                  </span>{" "}
                  changes the addon itself — Stremio keeps the catalog list it saw at install
                  time, so <span className="font-medium text-base-content/70">reinstall</span>{" "}
                  (button above) to apply those. Reinstalling also refreshes everything else
                  immediately.
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
            onChange={(e) => onPatch({ source: e.target.value })}
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
            {radar ? (
              <LabeledSelect
                label="Region"
                value={def.region}
                onChange={(region) => onPatch({ region })}
                options={regions.map((x) => ({
                  value: x.region,
                  label: `${x.region} — ${x.name}`,
                }))}
              />
            ) : (
              <>
                <LabeledSelect
                  label="Sort"
                  value={def.sort.key}
                  onChange={(key) => onPatch({ sort: { ...def.sort, key: key as SortKey } })}
                  options={SORT_KEYS.map((k) => ({ value: k, label: SORT_LABELS[k] }))}
                />
                <LabeledSelect
                  label="Direction"
                  value={def.sort.dir}
                  onChange={(dir) =>
                    onPatch({ sort: { ...def.sort, dir: dir as "asc" | "desc" } })
                  }
                  options={[
                    { value: "desc", label: "Descending ↓" },
                    { value: "asc", label: "Ascending ↑" },
                  ]}
                />
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
                  onChange={(v) =>
                    onPatch({ status: (v || null) as CatalogDef["status"] })
                  }
                  options={[
                    { value: "", label: "All statuses" },
                    ...STATUS_ORDER.map((s) => ({ value: s, label: s })),
                  ]}
                />
              </>
            )}
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
