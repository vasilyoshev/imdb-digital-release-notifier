import { useEffect, useState } from "react";
import { STATUS_ORDER } from "../lib/dashboard";
import type { SortKey } from "../lib/table-controls";
import { useLists, useSupportedRegions } from "../lib/queries";
import {
  type CatalogCfg,
  catalogCfg,
  RADAR_CATALOGS,
  setCatalogPatch,
  type StremioConfig,
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
 * The Stremio configure/install page (map #109, #113) — the target of
 * /configure and of Stremio's Configure button (/{token}/configure; the token
 * in the URL is ignored, edits are RLS-scoped to the signed-in user). Install
 * links + one card per catalog; every change saves immediately and reaches an
 * installed addon within ~5 minutes (the Worker's cache window).
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
  const config: StremioConfig = row?.config ?? {};
  const patch = (catalogId: string, p: Record<string, unknown>) =>
    update.mutate(setCatalogPatch(config, catalogId, p));

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
                    Install in Stremio
                  </a>
                  <a
                    className="btn btn-outline btn-sm"
                    href={webInstall ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install via Stremio Web
                  </a>
                  <button
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => setConfirmRegen(true)}
                  >
                    Regenerate link…
                  </button>
                </div>
              </div>
            </section>

            {/* Catalogs */}
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">
                  Catalogs
                </h2>
                <p className="mt-1 text-xs text-base-content/50">
                  Option changes (sort, filters, region) reach an installed addon within ~5
                  minutes — no reinstall. Turning a catalog on or off changes the addon
                  itself; Stremio usually picks that up when it next starts. If it
                  doesn&apos;t, reinstall from the link above.
                </p>
              </div>

              {(lists.data ?? []).map((l) => {
                const id = `list-${l.id}`;
                const cfg = catalogCfg(config, id);
                return (
                  <CatalogCard
                    key={id}
                    title={l.name}
                    badge={l.kind === "imdb_watchlist" ? "IMDb watchlist" : "manual list"}
                    cfg={cfg}
                    onToggle={(enabled) => patch(id, { enabled })}
                  >
                    <LabeledSelect
                      label="Sort"
                      value={cfg.sort.key}
                      onChange={(key) => patch(id, { sort: { ...cfg.sort, key } })}
                      options={SORT_KEYS.map((k) => ({ value: k, label: SORT_LABELS[k] }))}
                    />
                    <LabeledSelect
                      label="Direction"
                      value={cfg.sort.dir}
                      onChange={(dir) => patch(id, { sort: { ...cfg.sort, dir } })}
                      options={[
                        { value: "desc", label: "Descending ↓" },
                        { value: "asc", label: "Ascending ↑" },
                      ]}
                    />
                    <LabeledSelect
                      label="Popularity"
                      value={String(cfg.minVotes ?? "")}
                      onChange={(v) => patch(id, { minVotes: v ? Number(v) : null })}
                      options={VOTE_PRESETS.map((p) => ({
                        value: String(p.value ?? ""),
                        label: p.label,
                      }))}
                    />
                    <LabeledSelect
                      label="Status"
                      value={cfg.status ?? ""}
                      onChange={(v) => patch(id, { status: v || null })}
                      options={[
                        { value: "", label: "All statuses" },
                        ...STATUS_ORDER.map((s) => ({ value: s, label: s })),
                      ]}
                    />
                  </CatalogCard>
                );
              })}

              {RADAR_CATALOGS.map((r) => {
                const cfg = catalogCfg(config, r.id);
                return (
                  <CatalogCard
                    key={r.id}
                    title={r.name}
                    badge="radar"
                    cfg={cfg}
                    onToggle={(enabled) => patch(r.id, { enabled })}
                  >
                    <LabeledSelect
                      label="Region"
                      value={cfg.region}
                      onChange={(region) => patch(r.id, { region })}
                      options={(regions.data ?? []).map((x) => ({
                        value: x.region,
                        label: `${x.region} — ${x.name}`,
                      }))}
                    />
                  </CatalogCard>
                );
              })}
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
              remove the old addon in Stremio, then install again with the new link.
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
  title,
  badge,
  cfg,
  onToggle,
  children,
}: {
  title: string;
  badge: string;
  cfg: CatalogCfg;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{title}</span>
            <span className="badge badge-ghost badge-sm shrink-0">{badge}</span>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={cfg.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Show ${title} in Stremio`}
          />
        </div>
        {cfg.enabled && <div className="flex flex-wrap gap-3">{children}</div>}
      </div>
    </div>
  );
}

function LabeledSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-base-content/60">{label}</span>
      <select
        className="select select-sm select-bordered w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
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
