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
let activity, stats = {};
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
  ({ activity, stats } = await diarizeMulti(audio, models, opts));
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
} else {
  console.log(`labelled     none — fill in the speaker column of labels_TOFILL.csv to measure accuracy`);
}
