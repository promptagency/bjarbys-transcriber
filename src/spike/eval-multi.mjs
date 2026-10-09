// SPIKE — compare today's speaker separation with the multi-speaker prototype
// on a fixture with any number of speakers.
//
//   node --experimental-strip-types src/spike/eval-multi.mjs <fixture-dir> \
//     [--method current|multi] [--step 5] [--threshold 0.6] [--speakers N] [--min-speech 1]
//
// The fixture (outside the repo) holds excerpt.wav and labels.csv or
// labels_TOFILL.csv (idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end).
// With speaker labels filled in, word accuracy is reported under the best
// one-to-one matching of found speakers to true ones; without, only what was
// found. Prints numbers only — never transcript text.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AutoModelForAudioFrameClassification,
  AutoProcessor,
} from "@huggingface/transformers";
import {
  assignSpeakers,
  decodeActivity,
  planWindows,
  smoothSpeakers,
  stitchWindows,
  DIARIZE_WINDOW_MINUTES,
} from "../lib/diarize.ts";
import { diarizeMulti, loadModels } from "./multi-diarize.mjs";

const args = process.argv.slice(2);
const dir = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : fallback;
};
const method = flag("method", "multi");
const opts = {
  stepSec: Number(flag("step", 5)),
  threshold: Number(flag("threshold", 0.6)),
  numSpeakers: flag("speakers", null) ? Number(flag("speakers")) : null,
  minSpeechSec: Number(flag("min-speech", 1)),
  minClusterSize: Number(flag("min-cluster", 3)),
  method: flag("cluster", "ahc"),
  neighbours: Number(flag("neighbours", 10)),
};
if (!dir) throw new Error("usage: eval-multi.mjs <fixture-dir> [--method current|multi] …");

function readCsv(path) {
  const lines = readFileSync(path, "utf-8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const delim = lines[0].includes(";") ? ";" : ",";
  const cols = lines[0].split(delim).map((c) => c.trim());
  return lines.slice(1).map((line) => {
    const parts = line.split(delim);
    return Object.fromEntries(cols.map((c, i) => [c, parts[i] ?? ""]));
  });
}
function readWav(path) {
  const b = readFileSync(path);
  let o = 12, at = -1, size = 0;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === "data") { at = o + 8; size = n; break; }
    o += 8 + n + (n % 2);
  }
  const audio = new Float32Array(size / 2);
  for (let i = 0; i < audio.length; i++) audio[i] = b.readInt16LE(at + i * 2) / 32768;
  return audio;
}

const labelsPath = ["labels.csv", "labels_TOFILL.csv"].map((f) => join(dir, f)).find(existsSync);
const rows = readCsv(labelsPath);
const audio = readWav(join(dir, "excerpt.wav"));
const chunks = rows.map((r) => ({ text: r.text, timestamp: [Number(r.rel_start), Number(r.rel_end)] }));
const truth = rows.map((r) => (r.speaker ?? "").trim().toUpperCase());
const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;

const t0 = Date.now();
let activity, stats = {}, embedded = null;
if (method === "current") {
  const model = await AutoModelForAudioFrameClassification.from_pretrained("onnx-community/pyannote-segmentation-3.0", { dtype: "q8" });
  const processor = await AutoProcessor.from_pretrained("onnx-community/pyannote-segmentation-3.0");
  const sr = processor.sampling_rate;
  const parts = [];
  for (const window of planWindows(audio.length / sr, DIARIZE_WINDOW_MINUTES * 60)) {
    const s = Math.round(window.startSec * sr), e = Math.min(audio.length, Math.round(window.endSec * sr));
    const { logits } = await model(await processor(audio.subarray(s, e)));
    const [, frames, classes] = logits.dims;
    parts.push({ window, activity: decodeActivity(logits.data, frames, classes, (e - s) / sr, s / sr, window.index) });
  }
  activity = stitchWindows(parts);
} else {
  const models = await loadModels();
  ({ activity, stats, embedded } = await diarizeMulti(audio, models, opts));
}
const seconds = (Date.now() - t0) / 1000;
const predicted = smoothSpeakers(assignSpeakers(chunks, activity));

// What was found.
const ids = [...new Set(predicted.map((p) => p.speaker).filter((s) => s != null))].sort((a, b) => a - b);
const share = ids.map((id) => {
  const w = rows.reduce((n, r, i) => n + (predicted[i].speaker === id ? words(r.text) : 0), 0);
  return `${id}:${w}`;
});
const totalWords = rows.reduce((n, r) => n + words(r.text), 0);
const unassigned = rows.reduce((n, r, i) => n + (predicted[i].speaker == null ? words(r.text) : 0), 0);

console.log(`method       ${method}${method === "multi" ? ` ${JSON.stringify(opts)}` : ""}`);
console.log(`audio        ${(audio.length / 16000 / 60).toFixed(1)} min, ${rows.length} lines, ${totalWords} words`);
console.log(`time         ${seconds.toFixed(0)} s${stats.windows ? `  (segmentation ${stats.segSec} s, embeddings ${stats.embSec} s, clustering ${stats.clusterSec} s)` : ""}`);
if (stats.eigenvalues) console.log(`spectral     k=${stats.k}; eigenvalues ${stats.eigenvalues.join(" ")}`);
if (stats.windows) console.log(`windows      ${stats.windows}, local speakers ${stats.localSpeakers}, embedded ${stats.embeddings}, dropped ${stats.dropped}`);
console.log(`speakers     ${ids.length} found; words per speaker ${share.join("  ")}; no speaker ${unassigned}`);

// Accuracy, if labelled: best one-to-one matching of found → true speakers.
const labelled = truth.filter((t) => t && t !== "?").length;
if (labelled > 0) {
  const trueIds = [...new Set(truth.filter((t) => t && t !== "?"))].sort();
  const overlap = new Map();
  rows.forEach((r, i) => {
    if (!truth[i] || truth[i] === "?") return;
    const key = `${predicted[i].speaker}|${truth[i]}`;
    overlap.set(key, (overlap.get(key) ?? 0) + words(r.text));
  });
  // Exhaustive search over assignments of true ids to found ids (small numbers).
  let best = { score: -1, map: new Map() };
  const search = (k, used, map, score) => {
    if (k === trueIds.length) { if (score > best.score) best = { score, map: new Map(map) }; return; }
    let any = false;
    for (const id of ids) {
      if (used.has(id)) continue;
      any = true;
      used.add(id); map.set(id, trueIds[k]);
      search(k + 1, used, map, score + (overlap.get(`${id}|${trueIds[k]}`) ?? 0));
      used.delete(id); map.delete(id);
    }
    if (!any || ids.length < trueIds.length) search(k + 1, used, map, score); // a true speaker left unmatched
  };
  search(0, new Set(), new Map(), 0);
  const scoredWords = rows.reduce((n, r, i) => n + (truth[i] && truth[i] !== "?" ? words(r.text) : 0), 0);
  console.log(`labelled     ${labelled} lines; true speakers ${trueIds.join(",")}`);
  console.log(`matching     ${[...best.map].map(([id, t]) => `${id}→${t}`).join("  ")}`);
  console.log(`ACCURACY     ${((100 * best.score) / scoredWords).toFixed(1)}% of words (${best.score}/${scoredWords})`);
  // Per true speaker: how their words were labelled (numbers only).
  for (const t of trueIds) {
    const got = new Map();
    let n = 0;
    rows.forEach((r, i) => {
      if (truth[i] !== t) return;
      const w = words(r.text);
      n += w;
      const as = best.map.get(predicted[i].speaker) ?? (predicted[i].speaker == null ? "none" : `extra${predicted[i].speaker}`);
      got.set(as, (got.get(as) ?? 0) + w);
    });
    const right = got.get(t) ?? 0;
    console.log(`  ${t}: ${n} words, ${((100 * right) / n).toFixed(0)}% right; as ${[...got].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
} else {
  console.log(`labelled     none — fill in the speaker column of labels_TOFILL.csv to measure accuracy`);
}

// Diagnosis: can the voice model tell the true speakers apart? Each embedded
// local speaker gets the true label of the lines its speech overlaps most;
// then mean cosine distance within and between true speakers (numbers only).
if (embedded && labelled > 0) {
  const trueOf = (spans) => {
    const by = new Map();
    for (const [s, e] of spans) rows.forEach((r, i) => {
      const t = truth[i]; if (!t || t === "?") return;
      const o = Math.min(e, Number(r.rel_end)) - Math.max(s, Number(r.rel_start));
      if (o > 0) by.set(t, (by.get(t) ?? 0) + o);
    });
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const [t, v] = [...by].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return total > 0 && v / total >= 0.8 ? t : null; // only clear cases
  };
  const items = embedded.map((x) => ({ t: trueOf(x.local.spans), v: x.vector, w: x.local.window, at: x.local.start })).filter((x) => x.t);
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; } return 1 - d / Math.sqrt(na * nb); };
  const ts = [...new Set(items.map((x) => x.t))].sort();
  console.log(`\nDIAGNOSIS    ${items.length} embeddings with a clear true speaker: ${ts.map((t) => `${t}=${items.filter((x) => x.t === t).length}`).join(" ")}`);
  console.log(`mean cosine distance (lower = more alike)`);
  console.log(`      ${ts.map((t) => t.padStart(6)).join("")}`);
  for (const a of ts) {
    const cells = ts.map((b) => {
      let sum = 0, n = 0;
      const A = items.filter((x) => x.t === a), B = items.filter((x) => x.t === b);
      for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) { if (a === b && j <= i) continue; sum += cos(A[i].v, B[j].v); n++; }
      return (n ? (sum / n).toFixed(2) : "-").padStart(6);
    });
    console.log(`  ${a}   ${cells.join("")}`);
  }
  // Nearest-neighbour check: how often is an embedding's closest other embedding the same true speaker?
  let right = 0; const per = new Map();
  items.forEach((x, i) => {
    let best = Infinity, bj = -1;
    items.forEach((y, j) => { if (i !== j && Math.abs(x.w - y.w) > 2) { const d = cos(x.v, y.v); if (d < best) { best = d; bj = j; } } });
    const ok = items[bj].t === x.t; right += ok;
    const p = per.get(x.t) ?? [0, 0]; p[0] += ok; p[1]++; per.set(x.t, p);
  });
  console.log(`nearest neighbour (not within ±2 windows) same speaker: ${((100 * right) / items.length).toFixed(0)}%  (${ts.map((t) => `${t} ${((100 * per.get(t)[0]) / per.get(t)[1]).toFixed(0)}%`).join(", ")})`);
}
// Where in time each true speaker's words land per found speaker (B/C split check).
if (labelled > 0) {
  const total = audio.length / 16000, bins = 6;
  console.log(`\ntime split   found speaker per true speaker, by sixth of the recording (words)`);
  for (const t of [...new Set(truth.filter((x) => x && x !== "?"))].sort()) {
    const cells = [];
    for (let b = 0; b < bins; b++) {
      const got = new Map();
      rows.forEach((r, i) => {
        if (truth[i] !== t) return;
        const at = Number(r.rel_start);
        if (at < (b * total) / bins || at >= ((b + 1) * total) / bins) return;
        const k = predicted[i].speaker ?? "-";
        got.set(k, (got.get(k) ?? 0) + words(r.text));
      });
      cells.push([...got].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(",") || "·");
    }
    console.log(`  ${t}  ${cells.map((c) => c.padEnd(16)).join("")}`);
  }
}
