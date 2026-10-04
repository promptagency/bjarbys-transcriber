import {
  type Backend,
  type Dtype,
  DTYPE_LABEL,
  MODEL_GROUPS,
  MODELS,
  availableTiers,
  findModel,
  formatSize,
  isEnglishOnly,
} from "../lib/models";
import { EXPORT_FORMATS, type ExportFormat } from "../lib/exporters";

/** The readable formats: paragraphs per speaker turn rather than one line per fragment. */
const isDocument = (f: ExportFormat) => f === "md" || f === "doc";
import { type DeviceMode, LANGUAGES, type Settings } from "../lib/settings";
import { Field, Select } from "./ui";

export function AdvancedSettings({
  settings,
  onChange,
  resolvedDevice,
  webgpuAvailable,
  disabled,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  resolvedDevice: Backend;
  webgpuAvailable: boolean;
  disabled?: boolean;
}) {
  const model = findModel(settings.modelId)!;
  const tiers = availableTiers(model, resolvedDevice);
  const englishOnly = isEnglishOnly(settings.modelId);
  const currentTier = tiers.find((t) => t.dtype === settings.dtype) ?? tiers[0];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Model" hint={model.language}>
        <Select
          value={settings.modelId}
          disabled={disabled}
          onChange={(e) => onChange({ modelId: e.target.value })}
        >
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.recommended ? "  ★" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field
        label="Quality / size"
        hint={currentTier ? `${formatSize(currentTier.sizeMB)} download` : ""}
      >
        <Select
          value={settings.dtype}
          disabled={disabled}
          onChange={(e) => onChange({ dtype: e.target.value as Dtype })}
        >
          {tiers.map((t) => (
            <option key={t.dtype} value={t.dtype}>
              {DTYPE_LABEL[t.dtype]} — {formatSize(t.sizeMB)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Run on"
        hint={webgpuAvailable ? "WebGPU detected" : "WebGPU unavailable"}
      >
        <Select
          value={settings.deviceMode}
          disabled={disabled}
          onChange={(e) => onChange({ deviceMode: e.target.value as DeviceMode })}
        >
          <option value="auto">Auto ({webgpuAvailable ? "GPU" : "CPU"})</option>
          <option value="webgpu" disabled={!webgpuAvailable}>
            GPU — WebGPU{webgpuAvailable ? "" : " (not available)"}
          </option>
          <option value="wasm">CPU — WASM</option>
        </Select>
      </Field>

      {/*
        Not a <Field>, because that renders a single <label> — wrapping a group
        of checkboxes in one label would misassociate every click.
      */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Output formats
          </span>
          <span className="text-xs text-slate-500">
            {settings.exportFormats.length > 1
              ? "transcribed once · saved as a .zip"
              : "transcribed once per file"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
          {EXPORT_FORMATS.map((f) => {
            const checked = settings.exportFormats.includes(f.value);
            // Keep at least one format selected, so saving can't quietly
            // produce nothing.
            const isOnlyOne = checked && settings.exportFormats.length === 1;
            return (
              <label
                key={f.value}
                title={f.label}
                className={`flex items-center gap-2 text-sm text-slate-300 ${
                  disabled || isOnlyOne
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || isOnlyOne}
                  onChange={(e) =>
                    onChange({
                      exportFormats: e.target.checked
                        ? [...settings.exportFormats, f.value]
                        : settings.exportFormats.filter((v) => v !== f.value),
                    })
                  }
                  className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
                />
                {isDocument(f.value) ? f.label : `.${f.ext}`}
              </label>
            );
          })}
        </div>
        {settings.exportFormats.some(isDocument) && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={settings.documentTimestamps}
              onChange={(e) => onChange({ documentTimestamps: e.target.checked })}
              className="size-3.5 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
            />
            Timestamps in documents ([00:09] before each paragraph)
          </label>
        )}
      </div>

      <Field label="Language" hint={englishOnly ? "English-only model" : ""}>
        <Select
          value={settings.language ?? ""}
          disabled={disabled || englishOnly}
          onChange={(e) =>
            onChange({ language: e.target.value === "" ? null : e.target.value })
          }
        >
          {LANGUAGES.map((l) => (
            <option key={l.label} value={l.code ?? ""}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Task" hint="translate → English">
        <Select
          value={settings.task}
          disabled={disabled || englishOnly}
          onChange={(e) =>
            onChange({ task: e.target.value as "transcribe" | "translate" })
          }
        >
          <option value="transcribe">Transcribe (same language)</option>
          <option value="translate">Translate to English</option>
        </Select>
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.autoDownload}
          onChange={(e) => onChange({ autoDownload: e.target.checked })}
          className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        Automatically download each transcript when it finishes
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.diarizeSpeakers}
          onChange={(e) => onChange({ diarizeSpeakers: e.target.checked })}
          className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        Separate speakers (experimental — labels each line "Speaker 1",
        "Speaker 2", etc.)
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.keepTranscripts}
          onChange={(e) =>
            onChange({
              keepTranscripts: e.target.checked,
              keepTranscriptsAsked: true,
            })
          }
          className="mt-0.5 size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        <span>
          Keep finished transcripts in this browser after a reload
          <span className="mt-0.5 block text-xs text-slate-500">
            They stay until you delete them, and anyone using this browser could
            open them — leave this off on a shared computer. Turning it off
            deletes the saved copies.
          </span>
        </span>
      </label>
    </div>
  );
}
