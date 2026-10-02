// Word error rate with the normalization Klang AI and Sagascript report with:
// lowercase, punctuation removed, whitespace collapsed, no number
// normalization. Keeping it identical makes our numbers comparable to theirs.

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface WerCounts {
  sub: number;
  del: number;
  ins: number;
  refWords: number;
}

/** Word-level Levenshtein alignment, split into substitutions/deletions/insertions. */
export function werCounts(reference: string, hypothesis: string): WerCounts {
  const r = normalize(reference);
  const h = normalize(hypothesis);
  // dp[j] holds [cost, sub, del, ins] for the current row.
  type Cell = [number, number, number, number];
  let prev: Cell[] = Array.from({ length: h.length + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= r.length; i++) {
    const cur: Cell[] = [[i, 0, i, 0]];
    for (let j = 1; j <= h.length; j++) {
      const same = r[i - 1] === h[j - 1];
      const diag = prev[j - 1], up = prev[j], left = cur[j - 1];
      const options: Cell[] = [
        [diag[0] + (same ? 0 : 1), diag[1] + (same ? 0 : 1), diag[2], diag[3]],
        [up[0] + 1, up[1], up[2] + 1, up[3]],
        [left[0] + 1, left[1], left[2], left[3] + 1],
      ];
      cur.push(options.reduce((a, b) => (b[0] < a[0] ? b : a)));
    }
    prev = cur;
  }
  const [, sub, del, ins] = prev[h.length];
  return { sub, del, ins, refWords: r.length };
}

export function sumCounts(list: WerCounts[]): WerCounts {
  return list.reduce(
    (a, c) => ({
      sub: a.sub + c.sub,
      del: a.del + c.del,
      ins: a.ins + c.ins,
      refWords: a.refWords + c.refWords,
    }),
    { sub: 0, del: 0, ins: 0, refWords: 0 },
  );
}

export function werOf(c: WerCounts): number {
  return c.refWords ? (c.sub + c.del + c.ins) / c.refWords : 0;
}
