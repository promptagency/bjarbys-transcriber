/**
 * Build a Swedish ASR accuracy fixture from the FLEURS sv_se test split.
 *
 * Follows Sagascript's Pianissimo benchmark so the numbers are comparable: the
 * first reading of each distinct sentence, as separate clips, plus the same
 * clips joined with 0.5 s of silence into one long file.
 *
 *   curl -LO https://huggingface.co/datasets/google/fleurs/resolve/main/data/sv_se/test.tsv
 *   curl -L https://huggingface.co/datasets/google/fleurs/resolve/main/data/sv_se/audio/test.tar.gz | tar xz
 *   node scripts/build-fleurs-sv-fixture.mjs <raw-dir> <out-dir> [sentences]
 *
 * <raw-dir> holds test.tsv and test/*.wav. FLEURS is CC BY 4.0.
 *
 * Output:
 *   clips/NNN.wav  16 kHz mono 16-bit PCM
 *   clips.json     [{ file, reference }]
 *   long.wav       every clip joined with 0.5 s of silence
 *   long.txt       the joined reference text
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [rawDir, outDir, limitArg] = process.argv.slice(2);
if (!rawDir || !outDir) {
  console.error("usage: build-fleurs-sv-fixture.mjs <raw-dir> <out-dir> [sentences]");
  process.exit(1);
}
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
const RATE = 16000;

// FLEURS ships 32-bit float WAVs; find the fmt and data chunks rather than
// assuming a 44-byte header.
function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt = 1, bits = 16, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "fmt ") { fmt = b.readUInt16LE(o + 8); bits = b.readUInt16LE(o + 22); }
    if (id === "data") { data = b.subarray(o + 8, o + 8 + size); break; }
    o += 8 + size + (size % 2);
  }
  if (!data) throw new Error(`no data chunk in ${path}`);
  if (fmt === 3 && bits === 32) {
    const out = new Float32Array(data.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = data.readFloatLE(i * 4);
    return out;
  }
  if (fmt === 1 && bits === 16) {
    const out = new Float32Array(data.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
    return out;
  }
  throw new Error(`unsupported WAV format ${fmt}/${bits} in ${path}`);
}

function writeWav(path, pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    b.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, b);
}

// test.tsv columns: id, file, raw transcription, normalized, ... The same
// sentence id is read by several speakers; keep the first reading only.
const seen = new Set();
const picked = [];
for (const line of readFileSync(join(rawDir, "test.tsv"), "utf-8").split("\n")) {
  const cols = line.split("\t");
  if (cols.length < 3 || seen.has(cols[0])) continue;
  seen.add(cols[0]);
  picked.push({ src: cols[1], reference: cols[2] });
  if (picked.length >= limit) break;
}

mkdirSync(join(outDir, "clips"), { recursive: true });
const gap = new Float32Array(RATE / 2);
const parts = [];
const clips = picked.map((p, i) => {
  const pcm = readWav(join(rawDir, "test", p.src));
  const file = `clips/${String(i).padStart(3, "0")}.wav`;
  writeWav(join(outDir, file), pcm);
  parts.push(pcm, gap);
  return { file, reference: p.reference, seconds: +(pcm.length / RATE).toFixed(2) };
});

const total = parts.reduce((n, p) => n + p.length, 0);
const long = new Float32Array(total);
let at = 0;
for (const p of parts) { long.set(p, at); at += p.length; }
writeWav(join(outDir, "long.wav"), long);
writeFileSync(join(outDir, "clips.json"), JSON.stringify(clips, null, 1));
writeFileSync(join(outDir, "long.txt"), clips.map((c) => c.reference).join(" ") + "\n");

console.log(`${clips.length} sentences, long.wav ${(total / RATE / 60).toFixed(1)} min → ${outDir}`);
