// SPIKE — not app code. Does WeSpeaker ResNet34 (pyannote 3.1's embedding
// model) run in the browser via Transformers.js, how fast, and does it tell
// voices apart? Results go to window.__spike for the test harness.
import { AutoModel, AutoProcessor, env, Tensor } from "@huggingface/transformers";

env.allowLocalModels = false;
const MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";
const CLIPS = ["Alva-1", "Alva-2", "Daniel-1", "Daniel-2", "Samantha-1", "Samantha-2", "Fred-1", "Fred-2"];
const out = document.getElementById("out")!;
const log = (s: string) => (out.textContent += s + "\n");

async function decode(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(buf);
  return audio.getChannelData(0).slice();
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

async function run(device: "webgpu" | "wasm", dtype: "fp32" | "q8") {
  const t0 = performance.now();
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const model = await AutoModel.from_pretrained(MODEL, { device, dtype });
  const loadMs = Math.round(performance.now() - t0);
  const embeddings: Float32Array[] = [];
  const times: number[] = [];
  let outputNames = "";
  for (const clip of CLIPS) {
    const audio = await decode(`/test-audio/voice-${clip}.wav`);
    const t = performance.now();
    const inputs = await processor(audio);
    const outputs = (await model(inputs)) as Record<string, Tensor>;
    outputNames ||= Object.keys(outputs).map((k) => `${k}${JSON.stringify(outputs[k].dims)}`).join(", ");
    const first = Object.values(outputs)[0];
    embeddings.push(Float32Array.from(first.data as Float32Array));
    times.push(performance.now() - t);
  }
  await model.dispose();
  const matrix = CLIPS.map((_, i) => CLIPS.map((_, j) => cosine(embeddings[i], embeddings[j])));
  const same: number[] = [], diff: number[] = [];
  for (let i = 0; i < CLIPS.length; i++) for (let j = i + 1; j < CLIPS.length; j++) {
    (CLIPS[i].split("-")[0] === CLIPS[j].split("-")[0] ? same : diff).push(matrix[i][j]);
  }
  const r = {
    device, dtype, loadMs, outputNames,
    msPerClip: Math.round(times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1)),
    firstClipMs: Math.round(times[0]),
    sameVoice: { min: Math.min(...same).toFixed(3), avg: (same.reduce((a, b) => a + b, 0) / same.length).toFixed(3) },
    differentVoice: { max: Math.max(...diff).toFixed(3), avg: (diff.reduce((a, b) => a + b, 0) / diff.length).toFixed(3) },
    separable: Math.min(...same) > Math.max(...diff),
  };
  log(JSON.stringify(r));
  return r;
}

(async () => {
  const results = [];
  for (const [device, dtype] of [["wasm", "fp32"], ["wasm", "q8"], ["webgpu", "fp32"]] as const) {
    try { results.push(await run(device, dtype)); }
    catch (e) { const r = { device, dtype, error: String((e as Error)?.message ?? e) }; log(JSON.stringify(r)); results.push(r); }
  }
  (window as unknown as { __spike: unknown }).__spike = results;
  log("done");
})();
