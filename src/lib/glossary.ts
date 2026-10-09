// The word list (Ordlista): names and terms the user expects in their
// recordings. Whisper mishears them in ways that still *sound* right —
// "Hedsner" for Hetzner, "Pya Notte" for pyannote, "Micke Kvick" for Micke
// Quick — so a finished transcript is searched for word sequences whose
// sound-alike spelling is close to a term, and those become suggestions the
// user accepts or ignores. Nothing changes on its own: a wrong automatic
// correction would be worse than the error it replaced.
//
// Measured on synthetic Swedish speech (KB-Whisper Base and Small): at the
// threshold below it caught 10–11 of the misheard terms per transcript and
// made no false suggestion in 4,200 words of ordinary Swedish prose, where a
// looser 0.75 turned "ville", "vit" and "visste" into "Vite".
import type { TranscriptChunk } from "./protocol";

/** How alike (1 = identical) a stretch of words must sound to a term. */
const THRESHOLD = 0.85;
/** Each word more or fewer than the term has costs this much, so neighbours aren't swallowed. */
const LENGTH_PENALTY = 0.06;
/** Keeps a pasted novel from making every line slow to match. */
export const MAX_TERMS = 300;
const MAX_TERM_LENGTH = 80;

/** The terms in the user's word list: one per line, trimmed, duplicates dropped. */
export function glossaryTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const term = line.replace(/\s+/g, " ").trim().slice(0, MAX_TERM_LENGTH);
    if (!term || !/[\p{L}\p{N}]/u.test(term) || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** Whether the word list already has `term`, ignoring case and spacing. */
export function hasTerm(terms: string[], term: string): boolean {
  const wanted = term.replace(/\s+/g, " ").trim().toLowerCase();
  return terms.some((t) => t.toLowerCase() === wanted);
}

/**
 * The word list with `additions` appended — those not already in it, in
 * order, while there is room. Returns the new text and which terms were added.
 */
export function addTerms(text: string, additions: string[]): { text: string; added: string[]; full: boolean } {
  const terms = glossaryTerms(text);
  const added: string[] = [];
  let full = false;
  for (const addition of glossaryTerms(additions.join("\n"))) {
    if (hasTerm(terms, addition)) continue;
    if (terms.length >= MAX_TERMS) {
      full = true;
      break;
    }
    terms.push(addition);
    added.push(addition);
  }
  return { text: terms.join("\n"), added, full };
}

/** The word list without `term`. */
export function removeTerm(text: string, term: string): string {
  return glossaryTerms(text)
    .filter((t) => t !== term)
    .join("\n");
}

/**
 * Whether a word reads like a name or term rather than ordinary text: a
 * capital after its first letter ("iPhone", "KB-Whisper"), letters mixed with
 * digits ("GPT4"), a dotted name ("Transformers.js"), or a capital first letter
 * where a sentence doesn't start. Plain numbers ("2024", "14.30"), short
 * abbreviations ("t.ex", "bl.a") and lower-case compounds ("e-post") are not.
 */
function looksLikeTerm(word: string, sentenceStart: boolean): boolean {
  if (!/\p{L}/u.test(word)) return false;
  if (/^.+\p{Lu}/u.test(word)) return true;
  if (/\p{N}/u.test(word)) return true;
  if (/\p{L}\.\p{L}/u.test(word) && !/^(\p{L}{1,3}\.)+\p{L}{1,3}$/u.test(word)) return true;
  return /^\p{Lu}/u.test(word) && !sentenceStart;
}

/**
 * Names and terms a hand edit brought into a line, to offer for the word list:
 * words in `after` that weren't in `before` and look like a name or term,
 * joined with name-like neighbours ("Micke Kvick" → "Micke Quick" offers
 * "Micke Quick", not just "Quick"). Not already listed in `terms`.
 */
export function newTermsIn(before: string, after: string, terms: string[]): string[] {
  const oldWords = [...before.matchAll(WORD)];
  const old = new Set(oldWords.map((m) => m[0]));
  // Capitalised words that were followed by another capitalised word: the
  // first half of a name ("Micke" in "Micke Kvick"), even at a sentence start.
  const nameStarts = new Set(
    oldWords
      .filter((m, k) => {
        const next = oldWords[k + 1];
        return (
          next &&
          /^\p{Lu}/u.test(m[0]) &&
          /^\p{Lu}/u.test(next[0]) &&
          /^ +$/.test(before.slice(m.index! + m[0].length, next.index!))
        );
      })
      .map((m) => m[0]),
  );
  const words = [...after.matchAll(WORD)].map((m) => {
    const start = m.index!;
    // At the start of the line or after a full stop, a capital says nothing.
    const sentenceStart = /(^|[.!?…:])["“”'’(\s]*$/u.test(after.slice(0, start));
    return {
      text: m[0],
      start,
      end: start + m[0].length,
      termLike: looksLikeTerm(m[0], sentenceStart),
      isNew: !old.has(m[0]),
    };
  });
  const found: string[] = [];
  for (let i = 0; i < words.length; ) {
    if (!words[i].termLike) {
      i++;
      continue;
    }
    // A run of name-like words, separated only by spaces.
    const spaced = (a: number, b: number) => /^ +$/.test(after.slice(words[a].end, words[b].start));
    let j = i;
    while (j + 1 < words.length && words[j + 1].termLike && spaced(j, j + 1)) j++;
    // A capitalised word just before it, at the start of a sentence, belongs to
    // the name if it's new or began a name before ("Micke Kvick sa" → "Micke
    // Quick sa"); otherwise it's just the sentence's first word.
    const prev = words[i - 1];
    if (prev && /^\p{Lu}/u.test(prev.text) && spaced(i - 1, i) && (prev.isNew || nameStarts.has(prev.text))) i--;
    if (words.slice(i, j + 1).some((w) => w.isNew)) {
      const term = after.slice(words[i].start, words[j].end);
      if (!hasTerm(terms, term) && !found.includes(term)) found.push(term);
    }
    i = j + 1;
  }
  return found;
}

/**
 * A spelling of how something sounds, coarse enough that Whisper's guesses at
 * a foreign or unusual name land near the real one: w≈v, qu≈kv, z≈s, c≈k/s,
 * ph≈f, doubled letters as one, and no spaces or punctuation.
 */
export function soundKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/é|è|ë/g, "e")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/qu/g, "kv")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/z/g, "s")
    .replace(/x/g, "ks")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/dt/g, "t")
    .replace(/ts/g, "s")
    .replace(/(.)\1+/gu, "$1");
}

/** Edit distance between `a` and `b`, or `limit + 1` as soon as it must exceed `limit`. */
function boundedDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** How alike two sound keys are, 0…1; below THRESHOLD reported as 0 without the full work. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  const limit = Math.floor((1 - THRESHOLD) * longest);
  const distance = boundedDistance(a, b, limit);
  return distance > limit ? 0 : 1 - distance / longest;
}

export interface Suggestion {
  /** The line (chunk index) it is in. */
  index: number;
  /** [start, end) in the chunk's text — the misheard words, without punctuation around them. */
  start: number;
  end: number;
  /** The words as transcribed. */
  found: string;
  /** The word-list term they should be. */
  term: string;
}

/** Suggestions with the same misheard words and term are accepted or ignored together. */
export const groupKey = (s: Pick<Suggestion, "found" | "term">) =>
  `${s.found.toLowerCase()}\u0000${s.term}`;

/** A word: letters and digits, with inner hyphens, apostrophes or dots ("KB-Whisper", "Transformers.js"). */
const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’.-]*[\p{L}\p{N}])?/gu;

interface Prepared {
  term: string;
  key: string;
  words: number;
  /** Lower-cased, for "already written this way". */
  plain: string;
}

function prepare(terms: string[]): Prepared[] {
  return terms
    .map((term) => ({
      term,
      key: soundKey(term),
      words: term.split(" ").length,
      plain: term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(),
    }))
    .filter((p) => p.key.length >= 2);
}

interface Span {
  start: number;
  end: number;
  raw: string;
  plain: string;
  key: string;
}

/** Suggestions in one line of text. */
function suggestIn(text: string, index: number, terms: Prepared[], maxWords: number): Suggestion[] {
  const words = [...text.matchAll(WORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  // Each stretch of words is spelled out once, not once per term.
  const spans = new Map<string, Span>();
  const span = (from: number, length: number): Span => {
    const id = `${from}:${length}`;
    let found = spans.get(id);
    if (!found) {
      const start = words[from].start;
      const end = words[from + length - 1].end;
      const raw = text.slice(start, end);
      found = {
        start,
        end,
        raw,
        plain: raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(),
        key: soundKey(raw),
      };
      spans.set(id, found);
    }
    return found;
  };
  const out: Suggestion[] = [];
  for (let i = 0; i < words.length; ) {
    let best: { term: Prepared; length: number; score: number } | null = null;
    let already = 0; // words at i that already spell a term exactly
    for (let length = 1; length <= maxWords && i + length <= words.length; length++) {
      const here = span(i, length);
      for (const term of terms) {
        if (length < term.words - 1 || length > term.words + 1) continue;
        if (here.plain === term.plain) {
          // Spelled like the term already (perhaps in other case): leave it,
          // and don't let a looser match claim these words either.
          already = Math.max(already, length);
          continue;
        }
        const sim = similarity(here.key, term.key);
        if (sim < THRESHOLD) continue;
        // A word at either edge must earn its place: if the stretch without it
        // matches as well ("i Plausible" when "Plausible" is the term), it
        // belongs to the sentence, not the term.
        if (length > 1) {
          const inner = [span(i + 1, length - 1), span(i, length - 1)];
          if (inner.some((x) => x.plain === term.plain || similarity(x.key, term.key) >= sim)) continue;
        }
        const score = sim - LENGTH_PENALTY * Math.abs(length - term.words);
        if (!best || score > best.score || (score === best.score && length < best.length)) {
          best = { term, length, score };
        }
      }
    }
    if (already > 0) {
      i += already;
    } else if (best) {
      const { start, end, raw } = span(i, best.length);
      out.push({ index, start, end, found: raw, term: best.term.term });
      i += best.length;
    } else {
      i++;
    }
  }
  return out;
}

/** Every suggestion in the transcript, line by line and left to right. */
export function findSuggestions(chunks: TranscriptChunk[], terms: string[]): Suggestion[] {
  const prepared = prepare(terms);
  if (prepared.length === 0) return [];
  const maxWords = Math.max(...prepared.map((p) => p.words)) + 1;
  return chunks.flatMap((chunk, index) => suggestIn(chunk.text, index, prepared, maxWords));
}

/**
 * The lines with `suggestions` accepted, marked `edited` as a hand edit would
 * be. A term ending in punctuation ("Vem sa vad?") doesn't double up with
 * punctuation already after the words ("Vemsavad." → "Vem sa vad.").
 */
export function applySuggestions(
  chunks: TranscriptChunk[],
  suggestions: Suggestion[],
): Map<number, TranscriptChunk> {
  const byLine = new Map<number, Suggestion[]>();
  for (const s of suggestions) byLine.set(s.index, [...(byLine.get(s.index) ?? []), s]);
  const changes = new Map<number, TranscriptChunk>();
  for (const [index, list] of byLine) {
    const chunk = chunks[index];
    if (!chunk) continue;
    let text = chunk.text;
    // Right to left, so earlier offsets stay valid.
    for (const s of [...list].sort((a, b) => b.start - a.start)) {
      if (text.slice(s.start, s.end) !== s.found) continue; // the line changed since
      const followedByPunctuation = /^[.,!?;:]/.test(text.slice(s.end));
      const term = followedByPunctuation ? s.term.replace(/[.,!?;:]+$/, "") : s.term;
      text = text.slice(0, s.start) + term + text.slice(s.end);
    }
    if (text !== chunk.text) changes.set(index, { ...chunk, text, edited: true });
  }
  return changes;
}
