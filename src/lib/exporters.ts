// Turn a Whisper result into downloadable transcript formats.
import type { TranscriptResult } from "./protocol";

// "txt" is the readable document; "lines" is the older one-fragment-per-line
// text, kept for scripts and tools that read a transcript line by line.
export type ExportFormat = "txt" | "md" | "srt" | "vtt" | "json" | "lines";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] =
  [
    { value: "txt", label: "Document (.txt)", ext: "txt" },
    { value: "md", label: "Document (.md)", ext: "md" },
    { value: "srt", label: "Subtitles (.srt)", ext: "srt" },
    { value: "vtt", label: "WebVTT (.vtt)", ext: "vtt" },
    { value: "json", label: "JSON (.json)", ext: "json" },
    // A distinct suffix so it can sit next to the document .txt in one zip.
    { value: "lines", label: "Lines (.txt)", ext: "lines.txt" },
  ];

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "vtt":
      return "text/vtt";
    case "md":
      return "text/markdown;charset=utf-8";
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
      {
        text: toTxt(result, names).trim(),
        ...(result.language && { language: result.language }),
        ...(speakers && { speakers }),
        chunks,
      },
      null,
      2,
    ) + "\n"
  );
}

// ── Readable documents (.txt / .md) ────────────────────────────────
// The other formats keep Whisper's own segmentation — one short fragment per
// line — which suits tools but reads poorly. A document merges fragments into
// paragraphs: one per speaker turn, also split at long pauses, with the
// speaker named once and an optional timestamp per paragraph.

/** A pause at least this long starts a new paragraph even within one turn. */
const PARAGRAPH_PAUSE_SECONDS = 4;

export interface DocumentOptions {
  /** Shown as the heading — usually the file or episode name. */
  title: string;
  /** Prefix each paragraph with its start time. */
  timestamps: boolean;
  /** Date shown in the header; defaults to now. */
  date?: Date;
}

interface Paragraph {
  start: number;
  /** null for "no speaker detected", undefined when there are no speakers. */
  speaker: number | null | undefined;
  text: string;
}

function paragraphsOf(result: TranscriptResult): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let lastEnd = 0;
  for (const chunk of result.chunks ?? []) {
    const text = chunk.text.trim();
    if (!text) continue;
    const [start, end] = chunk.timestamp;
    const current = paragraphs[paragraphs.length - 1];
    const sameSpeaker = current && current.speaker === chunk.speaker;
    if (current && sameSpeaker && start - lastEnd < PARAGRAPH_PAUSE_SECONDS) {
      current.text += ` ${text}`;
    } else {
      paragraphs.push({ start, speaker: chunk.speaker, text });
    }
    lastEnd = end ?? start;
  }
  // No timestamped chunks at all: the whole text is one paragraph.
  if (paragraphs.length === 0 && result.text.trim()) {
    paragraphs.push({ start: 0, speaker: undefined, text: result.text.trim() });
  }
  return paragraphs;
}

/** 0:58, 12:05 or 1:02:03 — hours only when the recording needs them. */
function clockTime(seconds: number, withHours: boolean): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  return withHours
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

/** Escape text so Markdown shows it literally instead of formatting it. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_[\]<>#|~])/g, "\\$1")
    // "1994. Something", "1) …" or Whisper's subtitle-style "- Hej." at the
    // start of a paragraph would become a list item.
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^([-+])(?=\s|$)/, "\\$1");
}

/** YYYY-MM-DD in the user's own time zone (toISOString would give UTC's date). */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDocument(
  result: TranscriptResult,
  names: SpeakerNames,
  options: DocumentOptions,
  markdown: boolean,
): string {
  const paragraphs = paragraphsOf(result);
  const duration = Math.max(
    0,
    ...(result.chunks ?? []).map((c) => c.timestamp[1] ?? c.timestamp[0]),
  );
  const withHours = duration >= 3600;
  const ids = speakersIn(result);
  const esc = markdown ? escapeMarkdown : (t: string) => t;

  const facts = [
    localDate(options.date ?? new Date()),
    duration > 0 ? clockTime(duration, withHours) : null,
    ids.length ? `Speakers: ${ids.map((id) => speakerLabel(id, names)).join(", ")}` : null,
  ].filter(Boolean);

  const lines: string[] = markdown
    ? [`# ${esc(options.title)}`, "", `*${esc(facts.join(" · "))}*`, ""]
    : [options.title, facts.join(" · "), ""];

  for (const p of paragraphs) {
    const time = options.timestamps ? `[${clockTime(p.start, withHours)}]` : "";
    const who = p.speaker != null ? `${speakerLabel(p.speaker, names)}:` : "";
    const lead = [time, who].filter(Boolean).join(" ");
    if (markdown) {
      lines.push(lead ? `**${esc(lead)}** ${esc(p.text)}` : esc(p.text), "");
    } else {
      lines.push(lead ? `${lead} ${p.text}` : p.text, "");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function render(
  result: TranscriptResult,
  format: ExportFormat,
  names: SpeakerNames = {},
  document: DocumentOptions = { title: "Transcript", timestamps: true },
): string {
  switch (format) {
    case "md":
      return toDocument(result, names, document, true);
    case "txt":
      return toDocument(result, names, document, false);
    case "srt":
      return toSrt(result, names);
    case "vtt":
      return toVtt(result, names);
    case "json":
      return toJson(result, names);
    case "lines":
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
