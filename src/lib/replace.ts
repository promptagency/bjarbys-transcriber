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

/** Marks where a deleted match was, so tidying only touches its surroundings. */
const GONE = "\u0000";

/**
 * `text` with every match replaced by `replacement`, taken literally ("$&" is
 * not special); the rest of the line is left exactly as it was. The chunk's own
 * leading whitespace is kept — Whisper puts a space there for languages that use
 * them. An empty replacement deletes the word and tidies only where it was:
 * "Ja, eh, det" → "Ja, det", "Ja, eh." → "Ja.", "Eh, det" → "Det",
 * "\"Eh\", sa hon" → "sa hon".
 */
export function replaceInText(text: string, pattern: RegExp, replacement: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const original = text.slice(lead.length);
  if (replacement.trim() !== "") {
    const body = original.replace(pattern, () => replacement);
    return body ? lead + body : "";
  }
  let body = original
    .replace(pattern, GONE)
    .replace(/["“”«»]\s*\u0000\s*["“”«»]/g, GONE) // a quote that is now empty
    .replace(/([,;:])\s*\u0000\s*[,;:]/g, `$1${GONE}`) // "Ja, eh, det"
    .replace(/[,;:]\s*\u0000\s*([.!?])/g, `${GONE}$1`); // "Ja, eh."
  const atStart = /^\s*\u0000/.test(body);
  body = body
    .replace(/^\s*\u0000\s*[,;:]?\s*/, "") // "Eh, det"
    .replace(/\s*\u0000\s*([,.!?;:])/g, "$1") // no space before punctuation
    .replace(/\s*\u0000\s*/g, " ")
    .trim();
  if (/^[\p{P}\s]*$/u.test(body)) return ""; // nothing but punctuation left
  // Deleting the first word: capitalise the next one, unless it isn't plain
  // lower case ("iPhone" stays "iPhone").
  if (atStart && /^\p{Lu}/u.test(original) && /^\p{Ll}+(?![\p{L}\p{N}])/u.test(body)) {
    body = body[0].toUpperCase() + body.slice(1);
  }
  return lead + body;
}

/**
 * Matches that would actually change: with "match case" off, "anna" → "Anna"
 * also finds lines that already say "Anna", which a replacement leaves as is.
 */
export function changingMatches(text: string, pattern: RegExp, replacement: string): number {
  return [...text.matchAll(pattern)].filter((m) => m[0] !== replacement).length;
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
    const found = changingMatches(chunk.text, pattern, replacement);
    if (found === 0) return;
    const text = replaceInText(chunk.text, pattern, replacement);
    if (text === chunk.text) return;
    matches += found;
    changes.set(index, { ...chunk, text, edited: true });
  });
  return { changes, matches };
}
