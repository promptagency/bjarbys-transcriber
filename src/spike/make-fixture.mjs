// SPIKE — build a labelling sheet for a real recording, outside the repo.
//
//   node src/spike/make-fixture.mjs <fixture-dir>
//
// Reads <fixture-dir>/excerpt.wav (16 kHz mono), transcribes it with KB-Whisper
// Base the way the app does (30 s windows, 2.5 s stride, timestamps), and writes
// <fixture-dir>/labels_TOFILL.csv with an empty speaker column to fill in by
// hand. The output contains the transcript: it must never be committed.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";

const dir = process.argv[2];
if (!dir) throw new Error("usage: make-fixture.mjs <fixture-dir>");

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

const audio = readWav(join(dir, "excerpt.wav"));
const t0 = Date.now();
const asr = await pipeline("automatic-speech-recognition", "KBLab/kb-whisper-base", { dtype: "q8" });
const out = await asr(audio, {
  chunk_length_s: 30,
  stride_length_s: 2.5,
  return_timestamps: true,
  language: "sv",
  task: "transcribe",
});
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rows = ["idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end"];
let idx = 0;
for (const c of out.chunks) {
  const text = c.text.trim().replace(/[;\r\n]+/g, ",");
  if (!text) continue;
  const [start, endRaw] = c.timestamp;
  const end = endRaw ?? start + 2;
  rows.push([++idx, clock(start), "", text, (end - start).toFixed(2), start.toFixed(2), end.toFixed(2)].join(";"));
}
writeFileSync(join(dir, "labels_TOFILL.csv"), "﻿" + rows.join("\n") + "\n");
console.log(`${idx} lines, ${(audio.length / 16000 / 60).toFixed(1)} min audio, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
