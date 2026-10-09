// SPIKE — speaker separation with any number of speakers, pyannote-3.1 style:
//   1. segmentation-3.0 on short sliding windows (≤ 3 voices per window),
//   2. a WeSpeaker embedding per (window, local speaker), from the speech where
//      that speaker talks alone,
//   3. agglomerative clustering of all embeddings over the whole recording,
//   4. each window's local spans relabelled with their cluster.
// The result is SpeakerActivity[] — the same shape src/lib/diarize.ts produces —
// so assignSpeakers/smoothSpeakers are reused unchanged.
import {
  AutoModel,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
} from "@huggingface/transformers";
import { decodeActivity } from "../lib/diarize.ts";

const SEG = "onnx-community/pyannote-segmentation-3.0";
const EMB = "onnx-community/wespeaker-voxceleb-resnet34-LM";

export async function loadModels() {
  const [segModel, segProc, embModel, embProc] = await Promise.all([
    AutoModelForAudioFrameClassification.from_pretrained(SEG, { dtype: "q8" }),
    AutoProcessor.from_pretrained(SEG),
    AutoModel.from_pretrained(EMB, { dtype: "fp32" }),
    AutoProcessor.from_pretrained(EMB),
  ]);
  return { segModel, segProc, embModel, embProc };
}

/** Merge overlapping/adjacent [start, end] intervals. */
function union(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 0.01) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Parts of `a` not covered by any interval in `b`. */
function subtract(a, b) {
  let out = a.map((x) => [...x]);
  for (const [bs, be] of b) {
    out = out.flatMap(([s, e]) => {
      if (be <= s || bs >= e) return [[s, e]];
      const parts = [];
      if (bs > s) parts.push([s, bs]);
      if (be < e) parts.push([be, e]);
      return parts;
    });
  }
  return out;
}

const dur = (xs) => xs.reduce((n, [s, e]) => n + (e - s), 0);

function cosineDistance(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return 1 - dot / Math.sqrt(na * nb);
}

/**
 * Average-linkage agglomerative clustering on cosine distance. Stops at
 * `numSpeakers` clusters if given, otherwise when the closest pair is farther
 * apart than `threshold`. Returns a cluster index per item.
 */
export function cluster(embeddings, { threshold = 0.6, numSpeakers = null, minClusterSize = 3 } = {}) {
  const n = embeddings.length;
  let clusters = embeddings.map((_, i) => [i]);
  const d = embeddings.map((a) => embeddings.map((b) => cosineDistance(a, b)));
  const linkage = (A, B) => {
    let sum = 0;
    for (const i of A) for (const j of B) sum += d[i][j];
    return sum / (A.length * B.length);
  };
  const mergeClosest = (stopAbove) => {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const l = linkage(clusters[i], clusters[j]);
        if (l < best) { best = l; bi = i; bj = j; }
      }
    if (best > stopAbove) return false;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
    return true;
  };
  // Cluster by distance first, whether or not the number of speakers is known.
  while (clusters.length > 1 && mergeClosest(threshold));
  // Tiny clusters (a few windows) are almost always one speaker's odd moments
  // — a laugh, a cough, crosstalk — not a new person: fold each into the
  // nearest cluster that is big enough (pyannote's min_cluster_size).
  const big = clusters.filter((c) => c.length >= minClusterSize);
  if (big.length > 0 && big.length < clusters.length) {
    for (const small of clusters.filter((c) => c.length < minClusterSize)) {
      let nearest = big[0], best = Infinity;
      for (const b of big) {
        const l = linkage(small, b);
        if (l < best) { best = l; nearest = b; }
      }
      nearest.push(...small);
    }
    clusters = big;
  }
  // A known number of speakers: fold the smallest cluster into its nearest
  // neighbour until that many remain. (Merging the closest pair instead joins
  // two real people while noise clusters survive; forcing the count during
  // clustering isolates single outliers.)
  if (numSpeakers) {
    while (clusters.length > numSpeakers) {
      clusters.sort((a, b) => a.length - b.length);
      const [small, ...rest] = clusters;
      let nearest = rest[0], best = Infinity;
      for (const c of rest) {
        const l = linkage(small, c);
        if (l < best) { best = l; nearest = c; }
      }
      nearest.push(...small);
      clusters = rest;
    }
  }
  const label = new Array(n);
  clusters.forEach((c, k) => c.forEach((i) => (label[i] = k)));
  return label;
}

/**
 * Run the whole chain on 16 kHz mono `audio`. Returns { activity, stats }.
 * Options: windowSec (10), stepSec (5), minSpeechSec (1.0) for an embedding,
 * threshold / numSpeakers for clustering.
 */
export async function diarizeMulti(audio, models, opts = {}) {
  const { windowSec = 10, stepSec = 5, minSpeechSec = 1.0 } = opts;
  const sr = 16000;
  const total = audio.length / sr;
  const t0 = Date.now();

  // 1. Segmentation per window → local speakers with their spans.
  const locals = []; // { window, speaker, spans: [[s,e]] }
  let w = 0;
  for (let start = 0; start < total; start += stepSec, w++) {
    const end = Math.min(total, start + windowSec);
    const s = Math.round(start * sr), e = Math.round(end * sr);
    const { logits } = await models.segModel(await models.segProc(audio.subarray(s, e)));
    const [, frames, classes] = logits.dims;
    const spans = decodeActivity(logits.data, frames, classes, end - start, start, w);
    const bySpeaker = new Map();
    for (const a of spans) {
      if (!bySpeaker.has(a.speaker)) bySpeaker.set(a.speaker, []);
      bySpeaker.get(a.speaker).push([a.start, a.end]);
    }
    for (const [speaker, list] of bySpeaker) locals.push({ window: w, start, end, speaker, spans: union(list) });
    if (end >= total) break;
  }
  const segMs = Date.now() - t0;

  // 2. One embedding per local speaker, from speech where nobody else in the
  //    same window is talking (falls back to all its speech if that's too short).
  const t1 = Date.now();
  const embedded = [];
  for (const local of locals) {
    const others = locals.filter((o) => o.window === local.window && o !== local).flatMap((o) => o.spans);
    let parts = subtract(local.spans, union(others));
    if (dur(parts) < minSpeechSec) parts = local.spans;
    if (dur(parts) < minSpeechSec) continue; // too little to recognise: dropped
    const pieces = parts.map(([ps, pe]) => audio.subarray(Math.round(ps * sr), Math.round(pe * sr)));
    const joined = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of pieces) { joined.set(p, o); o += p.length; }
    const out = await models.embModel(await models.embProc(joined));
    embedded.push({ local, vector: Float32Array.from(Object.values(out)[0].data) });
  }
  const embMs = Date.now() - t1;

  // 3. Cluster all embeddings.
  const t2 = Date.now();
  const labels = cluster(embedded.map((x) => x.vector), opts);
  const clusterMs = Date.now() - t2;

  // 4. Relabel local spans with their cluster; union per global speaker.
  const perSpeaker = new Map();
  embedded.forEach((x, i) => {
    const g = labels[i] + 1;
    if (!perSpeaker.has(g)) perSpeaker.set(g, []);
    perSpeaker.get(g).push(...x.local.spans);
  });
  const activity = [];
  for (const [speaker, spans] of perSpeaker) for (const [start, end] of union(spans)) activity.push({ speaker, start, end });
  activity.sort((a, b) => a.start - b.start);

  return {
    activity,
    stats: {
      windows: w + 1,
      localSpeakers: locals.length,
      embeddings: embedded.length,
      dropped: locals.length - embedded.length,
      speakers: perSpeaker.size,
      segSec: +(segMs / 1000).toFixed(1),
      embSec: +(embMs / 1000).toFixed(1),
      clusterSec: +(clusterMs / 1000).toFixed(1),
    },
  };
}
