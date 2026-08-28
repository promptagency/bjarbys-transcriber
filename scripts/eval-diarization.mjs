/**
 * Measure speaker-attribution accuracy against a hand-labelled fixture.
 *
 * Runs the same code the app ships — decodeActivity/assignSpeakers/smoothSpeakers
 * from src/lib/diarize.ts — over a labelled excerpt, and reports the metrics that
 * decide whether the `speaker` field can be trusted.
 *
 *   node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
 *
 * The fixture directory is passed in rather than committed: it contains audio and
 * transcript text, which for real recordings is usually confidential. It needs:
 *   labels.csv    idx;time_in_clip;speaker;text;…;rel_start;rel_end   (`,` or `;`)
 *   excerpt.wav   the same audio, 16 kHz mono
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AutoModelForAudioFrameClassification,
  AutoProcessor,
} from "@huggingface/transformers";
import {
  decodeActivity,
  assignSpeakers,
  smoothSpeakers,
  LOW_CONFIDENCE,
  DIARIZE_WINDOW_MINUTES,
} from "../src/lib/diarize.ts";

const dir = process.argv[2];
const windowMinutes = Number(process.argv[3] ?? DIARIZE_WINDOW_MINUTES);
if (!dir) {
  console.error("usage: eval-diarization.mjs <fixture-dir> [windowMinutes]");
  process.exit(1);
}

// ── fixture ────────────────────────────────────────────────────────────────
function readCsv(path) {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  // Excel in a European locale writes ';' — accept whichever the header uses.
  const delim = lines[0].includes(";") ? ";" : ",";
  const cols = lines[0].split(delim);
  return lines.slice(1).map((line) => {
    // Fields may contain the delimiter only if quoted; the generator doesn't
    // quote, so a naive split is correct here and a wrong count is worth failing on.
    const parts = line.split(delim);
    if (parts.length !== cols.length) {
      throw new Error(`malformed row (${parts.length}/${cols.length}): ${line.slice(0, 80)}`);
    }
    return Object.fromEntries(cols.map((c, i) => [c.trim(), parts[i]]));
  });
}

function readWav(path) {
  const b = readFileSync(path);
  let o = 12, dataOffset = -1, dataSize = 0;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === "data") { dataOffset = o + 8; dataSize = size; break; }
    o += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("no data chunk in wav");
  const n = dataSize / 2;
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) audio[i] = b.readInt16LE(dataOffset + i * 2) / 32768;
  return audio;
}

const labelsPath = ["labels.csv", "labels_TOFILL.csv"]
  .map((f) => join(dir, f))
  .find(existsSync);
if (!labelsPath) throw new Error(`no labels.csv in ${dir}`);
const wavPath = join(dir, "excerpt.wav");
if (!existsSync(wavPath)) throw new Error(`no excerpt.wav in ${dir}`);

const rows = readCsv(labelsPath);
const audio = readWav(wavPath);

// Chunk timestamps are relative to the excerpt, matching the audio.
const chunks = rows.map((r) => ({
  text: r.text,
  timestamp: [Number(r.rel_start), Number(r.rel_end)],
}));
const truth = rows.map((r) => (r.speaker ?? "").trim().toUpperCase());

// ── run the shipping pipeline ──────────────────────────────────────────────
const model = await AutoModelForAudioFrameClassification.from_pretrained(
  "onnx-community/pyannote-segmentation-3.0", { dtype: "q8" });
const processor = await AutoProcessor.from_pretrained(
  "onnx-community/pyannote-segmentation-3.0");
const sampleRate = processor.sampling_rate;

const windowSamples = Math.round(windowMinutes * 60 * sampleRate);
const numWindows = Math.max(1, Math.ceil(audio.length / windowSamples));
const boundaries = [];
const activity = [];
for (let w = 0; w < numWindows; w++) {
  const s = w * windowSamples;
  const e = Math.min(audio.length, s + windowSamples);
  if (w > 0) boundaries.push(s / sampleRate);
  const { logits } = await model(await processor(audio.subarray(s, e)));
  const [, numFrames, numClasses] = logits.dims;
  activity.push(...decodeActivity(
    logits.data, numFrames, numClasses, (e - s) / sampleRate, s / sampleRate, w));
}
const predicted = smoothSpeakers(assignSpeakers(chunks, activity));

// ── metrics ────────────────────────────────────────────────────────────────
const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;

// Predicted ids are arbitrary integers; map each to the true label it covers
// most (standard diarization practice) before scoring.
const overlap = new Map();
rows.forEach((r, i) => {
  if (truth[i] === "?") return;
  const key = `${predicted[i].speaker}|${truth[i]}`;
  overlap.set(key, (overlap.get(key) ?? 0) + words(r.text));
});
const mapping = new Map();
for (const id of new Set(predicted.map((p) => p.speaker))) {
  let best = null, bestN = -1;
  for (const t of ["I", "S"]) {
    const n = overlap.get(`${id}|${t}`) ?? 0;
    if (n > bestN) { bestN = n; best = t; }
  }
  mapping.set(id, best);
}

let correct = 0, total = 0, scored = 0, skipped = 0;
const errors = [];
rows.forEach((r, i) => {
  const w = words(r.text);
  if (truth[i] === "?") { skipped += w; return; }
  total += w; scored++;
  if (mapping.get(predicted[i].speaker) === truth[i]) correct += w;
  else errors.push({ idx: r.idx, at: r.time_in_clip, truth: truth[i],
    got: mapping.get(predicted[i].speaker) ?? "null",
    conf: predicted[i].speaker_conf, words: w, dur: Number(r.dur_s), text: (r.text || "").slice(0, 58) });
});

const distinct = new Set(predicted.map((p) => p.speaker).filter((s) => s != null)).size;
let atBoundary = 0;
for (let i = 1; i < predicted.length; i++) {
  if (predicted[i].speaker === predicted[i - 1].speaker) continue;
  const t = predicted[i].timestamp[0];
  if (boundaries.some((b) => Math.abs(t - b) < 2)) atBoundary++;
}
const norm = (s) => (s || "").toLowerCase().replace(/\W+/g, " ").trim();
const seen = new Map();
let duplicates = 0;
rows.forEach((r) => {
  const k = norm(r.text);
  if (words(r.text) < 5) return;
  if (seen.has(k)) duplicates++;
  seen.set(k, true);
});

console.log(`fixture      ${labelsPath}`);
console.log(`audio        ${(audio.length / sampleRate / 60).toFixed(1)} min`);
console.log(`window       ${windowMinutes} min -> ${numWindows} pass(es), ${boundaries.length} boundary/ies`);
console.log(`labelled     ${scored} utterances scored, ${rows.length - scored} marked "?" (${skipped} words excluded)`);
console.log(`mapping      ${[...mapping].map(([k, v]) => `speaker ${k} -> ${v}`).join(", ")}`);
console.log();
console.log(`  1. word accuracy .............. ${((100 * correct) / total).toFixed(1)}%  (${correct}/${total})`);
console.log(`  2. distinct speakers .......... ${distinct}   (target: 2)`);
console.log(`  3. changes at window boundary . ${atBoundary}   (target: 0)`);
console.log(`  4. duplicated text spans ...... ${duplicates}   (target: 0)`);
console.log();
const lowConf = predicted.filter((p) => p.speaker != null && p.speaker_conf <= LOW_CONFIDENCE).length;
const errLow = errors.filter((e) => e.conf <= LOW_CONFIDENCE).length;
console.log(`low-confidence (<=${LOW_CONFIDENCE}): ${lowConf}/${predicted.length} utterances; ${errLow}/${errors.length} of the errors are flagged`);

const shortWrong = errors.filter((e) => e.dur < 1.5).reduce((n, e) => n + e.words, 0);
const wrongWords = total - correct;
console.log(`errors in utterances under 1.5 s: ${shortWrong}/${wrongWords} wrong words (${((100 * shortWrong) / wrongWords).toFixed(0)}%)`);

if (errors.length) {
  console.log(`\nworst misattributions by word count:`);
  errors.sort((a, b) => b.words - a.words).slice(0, 12).forEach((e) =>
    console.log(`  #${String(e.idx).padStart(3)} ${e.at}  truth=${e.truth} got=${e.got} conf=${e.conf}  ${e.text}`));
}
