// Word error rate: how many word substitutions, insertions and deletions turn
// the reference into the hypothesis, per reference word. Case and punctuation
// are ignored, so "Hej," and "hej" count as the same word.

export function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** 0 = identical; can exceed 1 when the hypothesis adds many words. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const r = words(reference);
  const h = words(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  // Two-row Levenshtein over words: O(r·h) time, O(h) memory, so a 30-minute
  // transcript (~5000 words) stays well under a second.
  let prev = new Uint32Array(h.length + 1).map((_, j) => j);
  let cur = new Uint32Array(h.length + 1);
  for (let i = 1; i <= r.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[h.length] / r.length;
}
