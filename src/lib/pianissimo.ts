// Klang AI's Pianissimo (Swedish FastConformer-TDT) via parakeet.js — runs in
// the worker. Kept apart from worker.ts's Whisper path because the runtime,
// file layout and caching are all different.
//
// What it took to make this work in a browser (measured, see spike/README.md
// on the spike/pianissimo branch):
//  • WebGPU only. On WASM the encoder runs at ~0.3x real time.
//  • A *symmetric* 4-bit encoder: Klang's published 4-bit files carry zero
//    points, which ORT Web's WebGPU MatMulNBits kernel rejects.
//  • The fp32 decoder on ONE thread. TDT decoding is one tiny ORT call per
//    audio frame; a thread pool makes each call slower, not faster.
//  • parakeet.js patches applied by scripts/postinstall.mjs.
import type { ParakeetModel } from "parakeet.js";
import type { FileProgress, TranscriptResult } from "./protocol";

const SAMPLE_RATE = 16000;
const ENCODER = "encoder-model.sym4.onnx";
const DECODER = "decoder_joint-model.onnx";
const VOCAB = "vocab.txt";

export interface PianissimoAssets {
  /** Absolute URL of the folder holding the three model files. */
  modelUrl: string;
  /** Absolute URL of parakeet.js's ONNX Runtime files (public/ort-parakeet/). */
  ortUrl: string;
}

export interface Pianissimo {
  transcribe(
    audio: Float32Array,
    onProgress: (progress: number) => void,
  ): Promise<TranscriptResult>;
  dispose(): Promise<void>;
}

// The files are cached by us, in the Cache API where transformers.js keeps the
// Whisper models, rather than in parakeet.js's IndexedDB cache — so all models
// follow the same storage rules and parakeet.js never reaches out to the Hub.
// If the browser refuses the space (in testing, one Chrome profile capped the
// origin at ~300 MB despite reporting gigabytes of quota), the file is simply
// downloaded again next time.
const CACHE_NAME = "pianissimo-models";

async function cachedBlobUrl(
  url: string,
  file: string,
  onProgress: (p: FileProgress) => void,
  useCache: boolean,
): Promise<{ blobUrl: string; fromCache: boolean }> {
  const cache = await caches.open(CACHE_NAME);
  const hit = useCache ? await cache.match(url) : undefined;
  if (hit) {
    const blob = await hit.blob();
    onProgress({ status: "done", file, loaded: blob.size, total: blob.size });
    return { blobUrl: URL.createObjectURL(blob), fromCache: true };
  }

  const res = await fetch(url).catch(() => {
    throw new Error(
      `Couldn't download the Pianissimo model file ${file} — check the connection.`,
    );
  });
  if (!res.ok || !res.body) {
    throw new Error(
      `Couldn't download the Pianissimo model file ${file} (HTTP ${res.status}). ` +
        `The model files must be deployed next to the app — see scripts/build-pianissimo-model.sh.`,
    );
  }
  // A server with a single-page-app fallback (like the bundled .htaccess)
  // answers a missing file with index.html and a 200.
  if (res.headers.get("content-type")?.includes("text/html")) {
    throw new Error(
      `The Pianissimo model file ${file} isn't deployed on this server — see scripts/build-pianissimo-model.sh.`,
    );
  }
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ status: "progress", file, loaded, total });
  }
  const blob = new Blob(chunks as BlobPart[]);
  await cache.put(url, new Response(blob)).catch(() => {});
  onProgress({ status: "done", file, loaded, total: total || loaded });
  return { blobUrl: URL.createObjectURL(blob), fromCache: false };
}

export async function loadPianissimo(
  assets: PianissimoAssets,
  onProgress: (p: FileProgress) => void,
): Promise<Pianissimo> {
  // Loaded on demand: it carries its own ONNX Runtime, which Whisper-only
  // sessions shouldn't pay for.
  const { fromUrls } = await import("parakeet.js");

  let usedCache = false;
  const open = async (useCache: boolean): Promise<ParakeetModel> => {
    const files = await Promise.all(
      [ENCODER, DECODER, VOCAB].map((f) =>
        cachedBlobUrl(new URL(f, assets.modelUrl).href, f, onProgress, useCache),
      ),
    );
    usedCache = files.some((f) => f.fromCache);
    const urls = files.map((f) => f.blobUrl);
    try {
      return await fromUrls({
        encoderUrl: urls[0],
        decoderUrl: urls[1],
        tokenizerUrl: urls[2],
        filenames: { encoder: ENCODER, decoder: DECODER },
        // 'webgpu-hybrid' = encoder on WebGPU, decoder on WASM. Spelled out
        // because fromUrls (unlike fromHub) doesn't map the 'webgpu' alias to it
        // and creates the sessions with an empty provider list.
        backend: "webgpu-hybrid",
        preprocessorBackend: "js",
        nMels: 128,
        cpuThreads: 1,
        wasmPaths: assets.ortUrl,
      });
    } finally {
      urls.forEach((u) => URL.revokeObjectURL(u));
    }
  };

  let model: ParakeetModel;
  try {
    model = await open(true);
  } catch (err) {
    // A truncated or stale cached file fails here as a parse error, and would
    // fail the same way on every load. Drop the cache and fetch afresh once.
    // Without a cache hit the failure is real (e.g. the GPU), so no retry.
    if (!usedCache) throw err;
    await caches.delete(CACHE_NAME);
    model = await open(false);
  }

  return {
    async transcribe(audio, reportProgress) {
      const durationSec = audio.length / SAMPLE_RATE;
      // transcribeLongAudio has no progress hook, but past 3 minutes it runs
      // transcribe() once per ~90 s window with that window's start offset —
      // which is enough to say how far through the file it is.
      const inner = model.transcribe.bind(model);
      model.transcribe = (windowAudio, sampleRate, opts) => {
        const start = (opts as { timeOffset?: number } | undefined)?.timeOffset ?? 0;
        const end = start + (windowAudio?.length ?? 0) / SAMPLE_RATE;
        return inner(windowAudio, sampleRate, opts).then((r) => {
          if (durationSec > 0) reportProgress(Math.min(0.99, end / durationSec));
          return r;
        });
      };
      try {
        const out = await model.transcribeLongAudio(audio, SAMPLE_RATE, {
          returnTimestamps: true,
        });
        return {
          text: out.text ?? "",
          chunks: (out.chunks ?? []).map((c) => ({
            text: c.text,
            timestamp: c.timestamp,
          })),
        };
      } finally {
        model.transcribe = inner;
      }
    },

    async dispose() {
      // parakeet.js has no dispose(); release the ORT sessions directly so the
      // GPU buffers go before another model loads.
      const m = model as unknown as {
        encoderSession?: { release(): Promise<void> };
        joinerSession?: { release(): Promise<void> };
      };
      await Promise.allSettled([
        m.encoderSession?.release(),
        m.joinerSession?.release(),
      ]);
    },
  };
}
