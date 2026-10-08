import { type Dtype, type Family, FAMILY_DEFAULT_MODEL, familyOf, findModel } from "./models";
import { EXPORT_FORMATS, type ExportFormat } from "./exporters";
import { DEFAULT_LANG, LANGS, type Lang } from "./i18n";

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
  /** Prefix each paragraph of the document formats (.txt, .md) with its time. */
  documentTimestamps: boolean;
  /** The interface language — also used for the text inside downloads. */
  uiLanguage: Lang;
}

// The labels are for the developer benchmark page; the app names languages in
// the interface language (see languageName in ./i18n).
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

/**
 * The language the recording control shows: "sv" and "en" for the Swedish and
 * English-only models, otherwise the chosen language, or null for auto-detect.
 */
export function spokenLanguage(s: Pick<Settings, "modelId" | "language">): string | null {
  const family = familyOf(s.modelId);
  if (family === "swedish") return "sv";
  if (family === "english") return "en";
  return s.language;
}

/**
 * Settings for a newly chosen recording language. The model follows: KB-Whisper
 * for Swedish, the English-only model for English, multilingual Whisper for
 * anything else or auto-detect — keeping the user's own model when it already fits.
 */
export function forSpokenLanguage(
  s: Pick<Settings, "modelId">,
  code: string | null,
): Pick<Settings, "modelId" | "language"> {
  const family: Family = code === "sv" ? "swedish" : code === "en" ? "english" : "multilingual";
  return {
    modelId: familyOf(s.modelId) === family ? s.modelId : FAMILY_DEFAULT_MODEL[family],
    language: code,
  };
}

/** Settings for a model picked by hand: KB-Whisper always transcribes Swedish. */
export function forModel(modelId: string): Partial<Settings> {
  const family = familyOf(modelId);
  if (family === "swedish") return { modelId, language: "sv" };
  if (family === "english") return { modelId, language: "en" };
  return { modelId };
}

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
  documentTimestamps: true,
  uiLanguage: DEFAULT_LANG,
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
  // Before the document became the default, "doc" was the document .txt and
  // "txt" the line-per-fragment one. A saved "txt" now means the document —
  // except next to "doc", where the user clearly wanted both, so it becomes "lines".
  const legacy = Array.isArray(raw.exportFormats) && raw.exportFormats.includes("doc");
  const formats = Array.isArray(raw.exportFormats)
    ? raw.exportFormats
        .map((f) => (f === "doc" ? "txt" : legacy && f === "txt" ? "lines" : f))
        .filter((f): f is ExportFormat => EXPORT_FORMATS.some((e) => e.value === f))
    : [];
  const restored: Settings = {
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
    documentTimestamps: pick(raw.documentTimestamps, isBool, d.documentTimestamps),
    uiLanguage: pick(
      raw.uiLanguage,
      (v): v is Lang => LANGS.includes(v as Lang),
      d.uiLanguage,
    ),
  };
  // Older saves could pair KB-Whisper with another language.
  return { ...restored, ...forModel(restored.modelId) };
}
