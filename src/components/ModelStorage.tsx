import { useCallback, useEffect, useState } from "react";
import { HardDrive, Trash2 } from "lucide-react";
import { findModel, formatSize } from "../lib/models";
import { modelName, type Strings, useT } from "../lib/i18n";
import {
  RUNTIME_ID,
  SPEAKER_MODEL_ID,
  type StoredGroup,
  deleteAllStored,
  deleteStored,
  listStored,
} from "../lib/modelStorage";
import { InfoTip } from "./ui";

/** Sizes as the model list shows them (decimal MB, GB from 1024 MB). */
function size(bytes: number): string {
  const mb = bytes / 1e6;
  return mb < 1 ? "< 1 MB" : formatSize(Math.round(mb));
}

function groupName(group: StoredGroup, t: Strings): string {
  if (group.id === RUNTIME_ID) return t.storage.runtime;
  if (group.id === SPEAKER_MODEL_ID) return t.storage.speakers;
  const model = findModel(group.id);
  return model ? modelName(model.name, t) : group.id;
}

/**
 * What's downloaded into this browser, with a way to remove it — models can
 * take gigabytes, and nothing else ever cleans them up (an installed app even
 * asks the browser never to). Settings and saved transcripts are untouched.
 */
export function ModelStorage({
  currentModelId,
  busy,
  refreshKey,
}: {
  /** The model chosen in Settings, marked "in use". */
  currentModelId: string;
  /** A model is loading or a job is running: removing is locked. */
  busy: boolean;
  /** Changes when the stored files may have changed (a load finished, a job ended). */
  refreshKey: string;
}) {
  const t = useT();
  const [groups, setGroups] = useState<StoredGroup[] | null | undefined>(undefined);
  const [confirmAll, setConfirmAll] = useState(false);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => setGroups(await listStored()), []);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  async function remove(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } finally {
      setConfirmAll(false);
      setWorking(false);
      await refresh();
    }
  }

  const locked = busy || working;
  const total = groups?.reduce((sum, g) => sum + g.bytes, 0) ?? 0;

  return (
    // A divider above sets storage apart from the transcription settings.
    <div className="border-t border-[var(--color-border)] pt-4 sm:col-span-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t.storage.title}
          <InfoTip text={t.storage.tip} />
        </span>
        {groups && groups.length > 0 && (
          <span className="text-xs text-neutral-500">{t.storage.total(size(total))}</span>
        )}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
        {groups === undefined ? null : groups === null ? (
          <p className="py-1 text-xs text-neutral-500">{t.storage.unavailable}</p>
        ) : groups.length === 0 ? (
          <p className="py-1 text-xs text-neutral-500">{t.storage.empty}</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center gap-3 py-1.5">
                  <HardDrive className="size-3.5 shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1 truncate text-neutral-200">
                    {groupName(group, t)}
                    {group.id === currentModelId && (
                      <span className="ml-2 rounded-full bg-mint-300 px-1.5 py-px text-[10px] font-semibold text-ink">
                        {t.storage.inUse}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-neutral-400">{size(group.bytes)}</span>
                  <button
                    type="button"
                    disabled={locked}
                    title={busy ? t.storage.busy : undefined}
                    onClick={() => remove(() => deleteStored(group.id))}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-white/5 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                  >
                    <Trash2 className="size-3.5" />
                    {t.storage.remove}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-end gap-2 border-t border-[var(--color-border)] pt-2">
              {confirmAll ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmAll(false)}
                    className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-white/5"
                  >
                    {t.storage.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => remove(deleteAllStored)}
                    className="rounded bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                  >
                    {t.storage.confirmAll}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  title={busy ? t.storage.busy : undefined}
                  onClick={() => setConfirmAll(true)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                >
                  <Trash2 className="size-3.5" />
                  {t.storage.removeAll}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
