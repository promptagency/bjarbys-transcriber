// Find & replace in a transcript's lines — for names and terms Whisper mishears
// the same way every time. Matching is literal (no pattern syntax), and "whole
// words" uses Unicode letter boundaries: \b treats å, ä and ö as non-letters,
// so it would find "Åsa" inside "Kåsa".
import type { TranscriptChunk } from "./protocol";

export interface FindOptions {
  matchCase: boolean;
  wholeWords: boolean;
}

/** A global regex for `query`, or null when there is nothing to search for. */
export function findPattern(query: string, options: FindOptions): RegExp | null {
  const literal = query.trim();
  if (!literal) return null;
  let source = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWords) source = `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}

/** [start, end) of every match in `text`, for highlighting. */
export function matchRanges(text: string, pattern: RegExp): [number, number][] {
  return [...text.matchAll(pattern)].map((m) => [m.index!, m.index! + m[0].length]);
}

/**
 * `text` with every match replaced by `replacement`, taken literally ("$&" is
 * not special). The chunk's own leading whitespace is kept — Whisper puts a
 * space there for languages that use them — and a deletion doesn't leave a
 * double space or a space before punctuation behind.
 */
export function replaceInText(text: string, pattern: RegExp, replacement: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const original = text.slice(lead.length);
  let body = original.replace(pattern, () => replacement);
  body = body.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1");
  if (replacement.trim() === "") {
    // "Ja, eh, det" → "Ja, det"; "Ja, eh." → "Ja."; "Eh, det" → "Det".
    body = body
      .replace(/["“”«»]\s*["“”«»]/g, "") // emptied quotes
      .replace(/([,;:])(\s*[,;:])+/g, "$1")
      .replace(/[,;:]\s*([.!?])/g, "$1")
      .replace(/^[,;:]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    if (/^[\p{P}\s]*$/u.test(body)) body = ""; // nothing but punctuation left
    if (/^\p{Lu}/u.test(original) && /^\p{Ll}/u.test(body)) {
      body = body[0].toUpperCase() + body.slice(1);
    }
  }
  body = body.trim();
  return body ? lead + body : "";
}

export interface Replacement {
  /** Changed lines only: index → the chunk as it should become. */
  changes: Map<number, TranscriptChunk>;
  matches: number;
}

/** Replace in every line; changed lines are marked `edited`, as a hand edit would be. */
export function replaceInChunks(
  chunks: TranscriptChunk[],
  pattern: RegExp,
  replacement: string,
): Replacement {
  const changes = new Map<number, TranscriptChunk>();
  let matches = 0;
  chunks.forEach((chunk, index) => {
    const found = matchRanges(chunk.text, pattern).length;
    if (found === 0) return;
    matches += found;
    const text = replaceInText(chunk.text, pattern, replacement);
    if (text !== chunk.text) changes.set(index, { ...chunk, text, edited: true });
  });
  return { changes, matches };
}
