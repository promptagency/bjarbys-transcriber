import { type Dtype, findModel } from "./models";
import { EXPORT_FORMATS, type ExportFormat } from "./exporters";

export type DeviceMode = "auto" | "webgpu" | "wasm";

export interface Settings {
  modelId: string;
  dtype: Dtype;
  deviceMode: DeviceMode;
  language: string | null;
  task: "transcribe" | "translate";
  /**
   * Formats to write when saving a transcript. The audio is only ever
   * analysed once — every format is rendered from the same stored result —
   * so selecting several costs nothing but the extra files.
   */
  exportFormats: ExportFormat[];
  autoDownload: boolean;
  diarizeSpeakers: boolean;
  /**
   * Opt-in: keep finished transcripts in this browser across reloads. Off by
   * default — they'd stay until deleted, which the user should choose
   * knowingly (e.g. not on a shared computer).
   */
  keepTranscripts: boolean;
  /** Whether the user has answered the one-time "keep transcripts?" prompt. */
  keepTranscriptsAsked: boolean;
}

export const LANGUAGES: { code: string | null; label: string }[] = [
  { code: null, label: "Auto-detect" },
  { code: "sv", label: "Swedish" },
  { code: "en", label: "English" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pt", label: "Portuguese" },
];

export const DEFAULT_SETTINGS: Settings = {
  modelId: "KBLab/kb-whisper-base",
  dtype: "q8",
  deviceMode: "auto",
  language: "sv",
  task: "transcribe",
  exportFormats: ["txt"],
  autoDownload: true,
  diarizeSpeakers: false,
  keepTranscripts: false,
  keepTranscriptsAsked: false,
};

/**
 * Settings saved by an earlier visit, checked field by field: anything
 * missing, invalid or no longer offered (e.g. a model that was removed) falls
 * back to its default rather than leaving the app in a broken state. The
 * quantization (`dtype`) is re-validated against the model and backend by
 * App's existing effect once WebGPU detection has run.
 */
export function restoreSettings(raw: Record<string, unknown> | null): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw) return d;
  const pick = <T,>(value: unknown, ok: (v: unknown) => v is T, fallback: T): T =>
    ok(value) ? value : fallback;
  const isString = (v: unknown): v is string => typeof v === "string";
  const isBool = (v: unknown): v is boolean => typeof v === "boolean";
  const formats = Array.isArray(raw.exportFormats)
    ? raw.exportFormats.filter((f): f is ExportFormat =>
        EXPORT_FORMATS.some((e) => e.value === f),
      )
    : [];
  return {
    modelId: pick(raw.modelId, (v): v is string => isString(v) && !!findModel(v), d.modelId),
    dtype: pick(raw.dtype, (v): v is Dtype => isString(v), d.dtype),
    deviceMode: pick(
      raw.deviceMode,
      (v): v is DeviceMode => v === "auto" || v === "webgpu" || v === "wasm",
      d.deviceMode,
    ),
    language: pick(
      raw.language,
      (v): v is string | null => LANGUAGES.some((l) => l.code === v),
      d.language,
    ),
    task: pick(
      raw.task,
      (v): v is Settings["task"] => v === "transcribe" || v === "translate",
      d.task,
    ),
    exportFormats: formats.length ? [...new Set(formats)] : d.exportFormats,
    autoDownload: pick(raw.autoDownload, isBool, d.autoDownload),
    diarizeSpeakers: pick(raw.diarizeSpeakers, isBool, d.diarizeSpeakers),
    keepTranscripts: pick(raw.keepTranscripts, isBool, d.keepTranscripts),
    keepTranscriptsAsked: pick(raw.keepTranscriptsAsked, isBool, d.keepTranscriptsAsked),
  };
}
