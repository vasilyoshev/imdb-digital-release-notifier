import { useState } from "react";
import type { List } from "../../lib/dashboard";
import {
  useDeletePushDevice,
  useLists,
  usePushDevices,
  useSettings,
  useSubscribeDevice,
  useUpdateList,
  useUpdateSettings,
} from "../../lib/queries";
import { pushConfigured, pushSupported } from "../../lib/push";
import { parseImdbUserId, type Settings, type WatchlistConfig } from "../../lib/settings";

/**
 * Settings behind the navbar gear (SPEC §9/§10/§11): a global card (email,
 * region order, gate hour, pause, push devices) and one card per list (sync +
 * notifications toggles + source config). Edits persist via RLS-permitted
 * UPDATE on `settings` and `lists`.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const lists = useLists();
  const ready = settings.data && lists.data;

  return (
    <dialog className={`modal ${open ? "modal-open" : ""}`}>
      <div className="modal-box max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!ready ? (
          <div className="grid place-items-center py-16">
            <span className="loading loading-dots loading-lg text-primary" />
          </div>
        ) : (
          <SettingsForm
            key={open ? "open" : "closed"}
            settings={settings.data!}
            lists={lists.data!}
            onClose={onClose}
          />
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}

interface EditableList {
  id: number;
  name: string;
  kind: string;
  syncEnabled: boolean;
  notificationsEnabled: boolean;
  imdbUserId: string;
}

function toEditable(l: List): EditableList {
  const wl = l.config as WatchlistConfig;
  return {
    id: l.id,
    name: l.name,
    kind: l.kind,
    syncEnabled: l.syncEnabled,
    notificationsEnabled: l.notificationsEnabled,
    imdbUserId: wl.imdb_user_id ?? "",
  };
}

function SettingsForm({
  settings,
  lists,
  onClose,
}: {
  settings: Settings;
  lists: List[];
  onClose: () => void;
}) {
  const [email, setEmail] = useState(settings.notifyEmail ?? "");
  const [regionCascade, setRegionCascade] = useState<string[]>(settings.regionCascade);
  const [hour, setHour] = useState(settings.notifyHour);
  const [paused, setPaused] = useState(settings.notificationsPaused);
  const [editLists, setEditLists] = useState<EditableList[]>(lists.map(toEditable));
  const [error, setError] = useState<string | null>(null);

  const updateSettings = useUpdateSettings();
  const updateList = useUpdateList();
  const saving = updateSettings.isPending || updateList.isPending;

  function moveRegion(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= regionCascade.length) return;
    const next = [...regionCascade];
    [next[i], next[j]] = [next[j], next[i]];
    setRegionCascade(next);
  }

  function patchList(id: number, patch: Partial<EditableList>) {
    setEditLists((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function onSave() {
    setError(null);
    try {
      await updateSettings.mutateAsync({
        notify_email: email.trim() || null,
        region_cascade: regionCascade,
        notify_hour: hour,
        notifications_paused: paused,
      });
      for (const l of editLists) {
        // Manual lists (Followed) have no source config — leave theirs untouched.
        await updateList.mutateAsync({
          id: l.id,
          patch: {
            sync_enabled: l.syncEnabled,
            notifications_enabled: l.notificationsEnabled,
            ...(l.kind === "imdb_watchlist"
              ? { config: { imdb_user_id: parseImdbUserId(l.imdbUserId) } }
              : {}),
          },
        });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Global card */}
      <section className="card border border-base-300 bg-base-200/40">
        <div className="card-body gap-4 p-4">
          <h3 className="text-sm font-semibold text-base-content/70">Global</h3>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-base-content/60">
              Notification email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder="you@example.com"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-base-content/60">
              Region cascade <span className="opacity-50">(effective date & providers)</span>
            </span>
            <ul className="flex flex-col gap-1">
              {regionCascade.map((r, i) => (
                <li
                  key={r}
                  className="flex items-center justify-between rounded-field border border-base-300 bg-base-100 px-3 py-1.5"
                >
                  <span className="font-mono text-sm">
                    <span className="mr-2 opacity-40">{i + 1}</span>
                    {r}
                  </span>
                  <span className="flex gap-1">
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveRegion(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveRegion(i, 1)}
                      disabled={i === regionCascade.length - 1}
                      aria-label={`Move ${r} down`}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-base-content/60">
                Gate hour (Europe/Sofia)
              </span>
              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="select"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>

            <label className="flex cursor-pointer items-center gap-3 pb-2">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
              />
              <span className="text-sm">
                Pause all notifications
                <span className="block text-xs text-base-content/50">
                  Runs still refresh data; nothing is sent.
                </span>
              </span>
            </label>
          </div>

          <PushDevices />
        </div>
      </section>

      {/* Per-list cards */}
      {editLists.map((l) => (
        <section key={l.id} className="card border border-base-300 bg-base-200/40">
          <div className="card-body gap-3 p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{l.name}</h3>
              <span className="badge badge-ghost badge-sm">
                {l.kind === "imdb_watchlist" ? "IMDb" : "Manual"}
              </span>
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={l.syncEnabled}
                  onChange={(e) => patchList(l.id, { syncEnabled: e.target.checked })}
                />
                <span className="text-sm">Sync</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={l.notificationsEnabled}
                  onChange={(e) =>
                    patchList(l.id, { notificationsEnabled: e.target.checked })
                  }
                />
                <span className="text-sm">Notifications</span>
              </label>
            </div>

            {l.kind === "imdb_watchlist" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-base-content/60">
                  Watchlist (IMDb user id or URL)
                </span>
                <input
                  type="text"
                  value={l.imdbUserId}
                  onChange={(e) => patchList(l.id, { imdbUserId: e.target.value })}
                  className="input w-full font-mono text-sm"
                  placeholder="ur27331503"
                />
              </label>
            )}
          </div>
        </section>
      ))}

      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      <div className="modal-action">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving && <span className="loading loading-spinner loading-sm" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

function PushDevices() {
  const devices = usePushDevices();
  const remove = useDeletePushDevice();
  const subscribe = useSubscribeDevice();
  const supported = pushSupported();
  const configured = pushConfigured();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-base-content/60">Push devices</span>
        <button
          className="btn btn-primary btn-xs"
          onClick={() => subscribe.mutate()}
          disabled={!supported || !configured || subscribe.isPending}
          title={
            !supported
              ? "This browser doesn't support push"
              : !configured
                ? "Push isn't configured in this build yet"
                : "Enable notifications on this device"
          }
        >
          {subscribe.isPending && <span className="loading loading-spinner loading-xs" />}
          Enable on this device
        </button>
      </div>
      {subscribe.isError && (
        <p className="mb-1 text-xs text-error">{(subscribe.error as Error).message}</p>
      )}
      {subscribe.isSuccess && (
        <p className="mb-1 text-xs text-success">This device is now subscribed.</p>
      )}
      {!configured && (
        <p className="mb-1 text-xs text-base-content/40">
          Push isn’t configured in this build yet.
        </p>
      )}
      {devices.isLoading ? (
        <span className="loading loading-dots loading-sm" />
      ) : (devices.data ?? []).length === 0 ? (
        <p className="text-xs text-base-content/50">
          No devices yet. Enable notifications from a device to add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(devices.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-1.5"
            >
              <span className="truncate font-mono text-xs text-base-content/60">
                {new URL(d.endpoint).host}
              </span>
              <button
                className="btn btn-ghost btn-xs text-error"
                onClick={() => remove.mutate(d.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
