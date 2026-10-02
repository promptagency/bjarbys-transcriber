/// <reference lib="webworker" />
// Runs ONE engine configuration per worker instance. The page spawns a fresh
// worker for every run so thread counts and memory don't leak between runs.
import { fromUrls } from "parakeet.js";
import { env, pipeline } from "@huggingface/transformers";

export type Engine = "pianissimo" | "whisper";

export interface RunConfig {
  engine: Engine;
  backend: "webgpu" | "wasm";
  /** pianissimo: encoder quant (int8/fp16/fp32). whisper: app dtype (q8/q4f16/fp32). */
  quant: string;
  /** pianissimo only: decoder/joint quant (int8/fp16/fp32). */
  decQuant: string;
  /** 0 = library default. */
  threads: number;
  whisperModel: string;
}

export type FromSpike =
  | { type: "log"; text: string }
  | { type: "loaded"; ms: number; detail: string }
  | { type: "clip"; i: number; text: string; ms: number }
  | { type: "long"; text: string; ms: number; chunks: number }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (m: FromSpike) => (self as unknown as Worker).postMessage(m);
const now = () => performance.now();

// Worker consoles aren't visible to the page; forward the libraries' own
// diagnostics (thread count, execution provider) into the page log.
for (const level of ["log", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (/thread|SIMD|WebGPU|webgpu|wasm|provider|backend|Error|error/i.test(text))
      post({ type: "log", text: `[${level}] ${text.slice(0, 300)}` });
  };
}

type Transcriber = {
  clip: (pcm: Float32Array) => Promise<string>;
  long: (pcm: Float32Array) => Promise<{ text: string; chunks: number }>;
};

let lastProgress = 0;
function progress(file: string, loaded: number, total: number) {
  const t = now();
  if (t - lastProgress < 2000) return;
  lastProgress = t;
  post({ type: "log", text: `downloading ${file} ${(loaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB` });
}

// parakeet.js drops spaces before any non-ASCII letter: its "no space before
// punctuation" rule is /\s+(?=[^\w\s])/ and JS \w is ASCII-only, so
// "kemiska ämnen" decodes as "kemiskaämnen". Same rules, Unicode-aware.
function decodeTokens(id2token: string[], blankId: number, ids: number[]): string {
  return ids
    .filter((id) => id !== blankId && id2token[id] !== undefined)
    .map((id) => id2token[id].replace(/▁/g, " "))
    .join("")
    .replace(/^\s+/, "")
    .replace(/\s+(?=[^\p{L}\p{N}_\s])/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Model files are served by the dev server from public/spike-models/ (see
// README in this folder): parakeet.js's IndexedDB cache silently fails to
// store the 630 MB encoder, so fromHub re-downloads it on every load.
const MODEL_BASE = `${self.location.origin}/spike-models/pianissimo`;
const fileFor = (base: string, quant: string) =>
  quant === "fp32" ? `${base}.onnx` : `${base}.${quant}.onnx`;

async function loadPianissimo(cfg: RunConfig): Promise<Transcriber> {
  const encoder = fileFor("encoder-model", cfg.quant);
  const decoder = fileFor("decoder_joint-model", cfg.decQuant);
  const model = await fromUrls({
    encoderUrl: `${MODEL_BASE}/${encoder}`,
    decoderUrl: `${MODEL_BASE}/${decoder}`,
    tokenizerUrl: `${MODEL_BASE}/vocab.txt`,
    filenames: { encoder, decoder },
    // fromUrls only sets the WebGPU provider for 'webgpu-hybrid'; the documented
    // 'webgpu' alias leaves the provider list empty and silently runs on CPU.
    backend: cfg.backend === "webgpu" ? "webgpu-hybrid" : "wasm",
    preprocessorBackend: "js",
    nMels: 128,
    // Same-origin runtime rather than parakeet.js's jsdelivr default.
    wasmPaths: `${self.location.origin}/spike-ort/`,
    ...(cfg.threads ? { cpuThreads: cfg.threads } : {}),
  });
  const tok = (model as unknown as { tokenizer: { id2token: string[]; blankId: number; decode: (ids: number[]) => string } }).tokenizer;
  tok.decode = (ids) => decodeTokens(tok.id2token, tok.blankId, ids);
  return {
    clip: async (pcm) => {
      const r = await model.transcribe(pcm, 16000);
      // Per-stage timings show where the time goes (preprocess/encode/decode).
      if (r.metrics) post({ type: "log", text: `metrics ${JSON.stringify(r.metrics)}` });
      return r.utterance_text;
    },
    long: async (pcm) => {
      const r = await model.transcribeLongAudio(pcm, 16000, { returnTimestamps: true });
      return { text: r.text, chunks: r.chunks?.length ?? 0 };
    },
  };
}

// Same dtype mapping as src/worker.ts: on WebGPU the encoder stays fp32.
function whisperDtype(quant: string, backend: string) {
  if (backend === "webgpu" && quant !== "fp32")
    return { encoder_model: "fp32", decoder_model_merged: "q4" };
  return quant;
}

async function loadWhisper(cfg: RunConfig): Promise<Transcriber> {
  env.allowLocalModels = false;
  if (cfg.threads && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = cfg.threads;
  const create = pipeline as unknown as (
    t: string, m: string, o: Record<string, unknown>,
  ) => Promise<(a: Float32Array, o: Record<string, unknown>) => Promise<{ text: string; chunks?: unknown[] }>>;
  const pipe = await create("automatic-speech-recognition", cfg.whisperModel, {
    device: cfg.backend,
    dtype: whisperDtype(cfg.quant, cfg.backend),
    progress_callback: (d: { file?: string; loaded?: number; total?: number }) =>
      d.loaded && d.total && progress(d.file ?? "?", d.loaded, d.total),
  });
  return {
    clip: async (pcm) => (await pipe(pcm, { language: "sv", task: "transcribe" })).text,
    long: async (pcm) => {
      // Same chunking the app uses.
      const r = await pipe(pcm, {
        language: "sv", task: "transcribe",
        chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
      });
      return { text: r.text, chunks: r.chunks?.length ?? 0 };
    },
  };
}

self.onmessage = async (e: MessageEvent<{ cfg: RunConfig; clips: Float32Array[]; long: Float32Array | null }>) => {
  const { cfg, clips, long } = e.data;
  try {
    const t0 = now();
    const asr = cfg.engine === "pianissimo" ? await loadPianissimo(cfg) : await loadWhisper(cfg);
    const isolated = (self as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated;
    // Which runtime files did ORT actually fetch? Tells same-origin vs CDN and
    // whether the threaded build was picked.
    const runtime = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /ort-wasm/.test(n))
      .map((n) => n.split("?")[0]);
    const threads = `${isolated ? "isolated" : "not isolated"}, ${navigator.hardwareConcurrency} cores; runtime: ${runtime.join(", ") || "?"}`;
    post({ type: "loaded", ms: now() - t0, detail: threads });

    // One untimed warm-up so the first clip doesn't carry shader/JIT compilation.
    if (clips.length) await asr.clip(clips[0]);

    for (let i = 0; i < clips.length; i++) {
      const t = now();
      const text = await asr.clip(clips[i]);
      post({ type: "clip", i, text, ms: now() - t });
    }
    if (long) {
      const t = now();
      const r = await asr.long(long);
      post({ type: "long", text: r.text, ms: now() - t, chunks: r.chunks });
    }
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: String((err as Error)?.stack ?? err) });
  }
};
