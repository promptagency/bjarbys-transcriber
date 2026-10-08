import {
  type Backend,
  type Dtype,
  MODEL_GROUPS,
  MODELS,
  availableTiers,
  findModel,
  formatSize,
  isEnglishOnly,
  tierSizeMB,
} from "../lib/models";
import { EXPORT_FORMATS, type ExportFormat } from "../lib/exporters";

/** The readable formats: paragraphs per speaker turn rather than one line per fragment. */
const isDocument = (f: ExportFormat) => f === "txt" || f === "md";
// Two formats end in .txt, so these show their name rather than just the extension.
const showLabel = (f: ExportFormat) => isDocument(f) || f === "lines";
import { type DeviceMode, type Settings, forModel } from "../lib/settings";
import { Field, Select } from "./ui";
import { modelName, useT } from "../lib/i18n";

export function AdvancedSettings({
  settings,
  onChange,
  resolvedDevice,
  webgpuAvailable,
  gpuF16,
  disabled,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  resolvedDevice: Backend;
  webgpuAvailable: boolean;
  /** Whether the GPU has `shader-f16` — decides what "Balanced (GPU)" downloads. */
  gpuF16: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const model = findModel(settings.modelId)!;
  const tiers = availableTiers(model, resolvedDevice);
  const englishOnly = isEnglishOnly(settings.modelId);
  const currentTier = tiers.find((t) => t.dtype === settings.dtype) ?? tiers[0];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t.settings.model} hint={t.settings.coverage[model.group]}>
        <Select
          value={settings.modelId}
          disabled={disabled}
          onChange={(e) => onChange(forModel(e.target.value))}
        >
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={t.settings.group[group]}>
              {MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {modelName(m.name, t)}
                  {m.recommended ? "  ★" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field
        label={t.settings.quality}
        hint={currentTier ? t.settings.download(formatSize(tierSizeMB(currentTier, gpuF16))) : ""}
      >
        <Select
          value={settings.dtype}
          disabled={disabled}
          onChange={(e) => onChange({ dtype: e.target.value as Dtype })}
        >
          {tiers.map((tier) => (
            <option key={tier.dtype} value={tier.dtype}>
              {t.settings.dtype[tier.dtype]} — {formatSize(tierSizeMB(tier, gpuF16))}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t.settings.runOn}
        hint={webgpuAvailable ? t.settings.webgpuFound : t.settings.webgpuMissing}
      >
        <Select
          value={settings.deviceMode}
          disabled={disabled}
          onChange={(e) => onChange({ deviceMode: e.target.value as DeviceMode })}
        >
          <option value="auto">{t.settings.auto(webgpuAvailable ? "GPU" : "CPU")}</option>
          <option value="webgpu" disabled={!webgpuAvailable}>
            {t.settings.gpu(webgpuAvailable)}
          </option>
          <option value="wasm">{t.settings.cpu}</option>
        </Select>
      </Field>

      {/*
        Not a <Field>, because that renders a single <label> — wrapping a group
        of checkboxes in one label would misassociate every click.
      */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t.settings.formats}
          </span>
          <span className="text-xs text-slate-500">
            {settings.exportFormats.length > 1 ? t.settings.formatsZip : t.settings.formatsOne}
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
                title={t.settings.format[f.value]}
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
                {showLabel(f.value) ? t.settings.format[f.value] : `.${f.ext}`}
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
            {t.settings.timestamps}
          </label>
        )}
      </div>

      <Field
        label={t.settings.task}
        hint={englishOnly ? t.settings.englishOnlyModel : t.settings.taskHint}
      >
        <Select
          value={settings.task}
          disabled={disabled || englishOnly}
          onChange={(e) =>
            onChange({ task: e.target.value as "transcribe" | "translate" })
          }
        >
          <option value="transcribe">{t.settings.transcribe}</option>
          <option value="translate">{t.settings.translate}</option>
        </Select>
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.autoDownload}
          onChange={(e) => onChange({ autoDownload: e.target.checked })}
          className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        {t.settings.autoDownload}
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
        <input
          type="checkbox"
          checked={settings.diarizeSpeakers}
          onChange={(e) => onChange({ diarizeSpeakers: e.target.checked })}
          className="size-4 rounded border-[var(--color-border)] bg-[var(--color-surface-2)] accent-sky-500"
        />
        {t.settings.diarize}
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
          {t.settings.keep}
          <span className="mt-0.5 block text-xs text-slate-500">{t.settings.keepHint}</span>
        </span>
      </label>
    </div>
  );
}
