// Turn a Whisper result into downloadable transcript formats.
import type { TranscriptResult } from "./protocol";

export type ExportFormat = "txt" | "srt" | "vtt" | "json";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] =
  [
    { value: "txt", label: "Plain text (.txt)", ext: "txt" },
    { value: "srt", label: "Subtitles (.srt)", ext: "srt" },
    { value: "vtt", label: "WebVTT (.vtt)", ext: "vtt" },
    { value: "json", label: "JSON (.json)", ext: "json" },
  ];

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "vtt":
      return "text/vtt";
    default:
      return "text/plain;charset=utf-8";
  }
}

export function extFor(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.value === format)!.ext;
}

/**
 * Strip characters that can't appear in a file name.
 *
 * Browsers sanitize the `download` attribute, so a direct download was always
 * safe — but ZIP has no such protection: `/` is its path separator, so a
 * podcast episode titled "3/12 recap" would silently nest the transcript in a
 * folder instead of sitting alongside the other formats. Leading dots go too,
 * so a title can't produce a hidden file or a `..` traversal entry.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "transcript";
}

/** Replace a filename's extension (or append one if absent). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

function pad(n: number, width = 2): string {
  return Math.floor(n).toString().padStart(width, "0");
}

/** Format seconds as HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT). */
function stamp(seconds: number, msSep: "," | "."): string {
  const s = Math.max(0, seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)}${msSep}${pad(ms, 3)}`;
}

/** Names the user gave a transcript's speakers, keyed by speaker number. */
export type SpeakerNames = Record<number, string>;

/** The user's name for a speaker, or "Speaker N" when none was given. */
export function speakerLabel(speaker: number, names: SpeakerNames = {}): string {
  return names[speaker]?.trim() || `Speaker ${speaker}`;
}

/**
 * Speaker numbers present in a transcript, in ascending order. By default only
 * speakers with actual words count: the text exports drop whitespace-only
 * chunks, so a speaker found only on those never appears in them and shouldn't
 * be offered for naming. JSON keeps every chunk, so it asks for all.
 */
export function speakersIn(
  result: TranscriptResult,
  { includeBlank = false }: { includeBlank?: boolean } = {},
): number[] {
  const ids = new Set<number>();
  for (const c of result.chunks ?? []) {
    if (c.speaker == null) continue;
    if (!includeBlank && c.text.trim().length === 0) continue;
    ids.add(c.speaker);
  }
  return [...ids].sort((a, b) => a - b);
}

function withSpeaker(
  chunk: TranscriptResult["chunks"][number],
  names: SpeakerNames,
): string {
  const text = chunk.text.trim();
  return chunk.speaker != null ? `${speakerLabel(chunk.speaker, names)}: ${text}` : text;
}

export function toTxt(result: TranscriptResult, names: SpeakerNames = {}): string {
  const chunks = result.chunks?.filter((c) => c.text.trim().length > 0) ?? [];
  if (chunks.some((c) => c.speaker != null)) {
    return chunks.map((c) => withSpeaker(c, names)).join("\n") + "\n";
  }
  return result.text.trim() + "\n";
}

function cuesFrom(result: TranscriptResult): TranscriptResult["chunks"] {
  const chunks = result.chunks?.filter((c) => c.text.trim().length > 0) ?? [];
  if (chunks.length > 0) return chunks;
  // No timestamps available — emit one cue spanning the whole text.
  return [{ text: result.text.trim(), timestamp: [0, null] }];
}

export function toSrt(result: TranscriptResult, names: SpeakerNames = {}): string {
  const cues = cuesFrom(result);
  return (
    cues
      .map((c, i) => {
        const start = c.timestamp[0] ?? 0;
        const end = c.timestamp[1] ?? start + 2;
        return `${i + 1}\n${stamp(start, ",")} --> ${stamp(end, ",")}\n${withSpeaker(c, names)}\n`;
      })
      .join("\n") + "\n"
  );
}

export function toVtt(result: TranscriptResult, names: SpeakerNames = {}): string {
  const cues = cuesFrom(result);
  const body = cues
    .map((c) => {
      const start = c.timestamp[0] ?? 0;
      const end = c.timestamp[1] ?? start + 2;
      return `${stamp(start, ".")} --> ${stamp(end, ".")}\n${withSpeaker(c, names)}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}\n`;
}

export function toJson(result: TranscriptResult, names: SpeakerNames = {}): string {
  // `text` is the readable rendering and `chunks` the structured data, so the
  // two fields have distinct jobs rather than one being a degraded copy of the
  // other. Whisper's own flat `text` is deliberately not used here: it carries
  // no speaker labels, so it contradicted the .txt/.srt/.vtt exports. Building
  // it via toTxt() keeps every format telling the same story. (It is not quite
  // the old value even without speakers: it's trimmed, where Whisper's own
  // text usually has a leading space.)
  //
  // `chunks` stays raw. JSON is the lossless format, so unlike the subtitle
  // exports it keeps whitespace-only chunks — they carry valid timestamps even
  // with no words. cuesFrom() is only a fallback for the case where Whisper
  // returned no timestamped chunks at all, so the transcript still survives.
  //
  // Chunks keep their numeric `speaker`; `speakers` maps each number to its
  // display name, so renaming never changes the structured data.
  const chunks = result.chunks?.length ? result.chunks : cuesFrom(result);
  const ids = speakersIn(result, { includeBlank: true });
  const speakers = ids.length
    ? Object.fromEntries(ids.map((id) => [id, speakerLabel(id, names)]))
    : undefined;
  return (
    JSON.stringify(
      { text: toTxt(result, names).trim(), ...(speakers && { speakers }), chunks },
      null,
      2,
    ) + "\n"
  );
}

export function render(
  result: TranscriptResult,
  format: ExportFormat,
  names: SpeakerNames = {},
): string {
  switch (format) {
    case "srt":
      return toSrt(result, names);
    case "vtt":
      return toVtt(result, names);
    case "json":
      return toJson(result, names);
    default:
      return toTxt(result, names);
  }
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(
  filename: string,
  text: string,
  format: ExportFormat,
): void {
  downloadBlob(filename, new Blob([text], { type: mimeFor(format) }));
}

/** Trigger a browser download of an already-built blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
