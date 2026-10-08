// What Transformers.js has downloaded into this browser, and how to remove it.
//
// Models are kept in Cache Storage (Transformers.js's `env.cacheKey`), keyed by
// their Hugging Face address — https://huggingface.co/<owner>/<repo>/resolve/
// main/<file> — and the ONNX runtime by its jsDelivr address. Every entry
// carries its size in `content-length` (Transformers.js sets it), so sizes are
// read without touching the files themselves.
//
// Used by the page (the Storage section in Settings) and by the worker (the
// automatic cleanup after a load). Never touches settings or saved transcripts.

export const MODEL_CACHE = "transformers-cache";

const HF_FILE = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/;
const RUNTIME_FILE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@([^/]+)\//;

/** Speaker separation's model (pyannote) — tiny, but shown so the list adds up. */
export const SPEAKER_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";
/** The group id used for the ONNX runtime's files. */
export const RUNTIME_ID = "runtime";

export interface StoredGroup {
  /** A Hugging Face repo id, or RUNTIME_ID. */
  id: string;
  bytes: number;
  files: number;
}

/** The group a cached address belongs to, or null for anything we don't recognise. */
function groupOf(url: string): string | null {
  const hf = HF_FILE.exec(url);
  if (hf) return hf[1];
  if (RUNTIME_FILE.test(url)) return RUNTIME_ID;
  return null;
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    // has() first, so merely looking doesn't create an empty cache.
    return (await caches.has(MODEL_CACHE)) ? await caches.open(MODEL_CACHE) : null;
  } catch {
    return null; // storage blocked (e.g. some private windows)
  }
}

/**
 * Everything downloaded, grouped per model, largest first. Null when the
 * browser doesn't let us look (no Cache Storage); empty when nothing is stored.
 */
export async function listStored(): Promise<StoredGroup[] | null> {
  if (typeof caches === "undefined") return null;
  const cache = await openCache();
  if (!cache) return [];
  const groups = new Map<string, StoredGroup>();
  for (const request of await cache.keys()) {
    const id = groupOf(request.url);
    if (!id) continue;
    const response = await cache.match(request);
    const bytes = Number(response?.headers.get("content-length")) || 0;
    const group = groups.get(id) ?? { id, bytes: 0, files: 0 };
    group.bytes += bytes;
    group.files += 1;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Remove every stored file of one group (a model, or the runtime). */
export async function deleteStored(id: string): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  for (const request of await cache.keys()) {
    if (groupOf(request.url) === id) await cache.delete(request);
  }
}

/** Remove every downloaded model and the runtime. Settings and transcripts stay. */
export async function deleteAllStored(): Promise<void> {
  try {
    await caches.delete(MODEL_CACHE);
  } catch {
    /* storage blocked: nothing to delete */
  }
}

// ── Automatic cleanup (run by the worker after a successful load) ─────────────

/** Transformers.js's file-name suffix for each quantization. */
const SUFFIX: Record<string, string> = {
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  int8: "_int8",
  uint8: "_uint8",
  q4: "_q4",
  q4f16: "_q4f16",
  bnb4: "_bnb4",
};

/** onnx/<part><suffix>.onnx, plus its external-data files (.onnx_data, .onnx_data_1…). */
const ONNX_PART = /^onnx\/(encoder_model|decoder_model_merged)(_[a-z0-9]+)?\.onnx(?:_data(?:_\d+)?)?$/;

/**
 * Delete what a successful load made redundant: the other quantizations of
 * `modelId`'s encoder and decoder, and ONNX runtimes other than `runtimeVersion`.
 * Only call this when the load used the dtype first asked for — after a
 * fallback the preferred files may still be wanted next time.
 */
export async function pruneAfterLoad(
  modelId: string,
  dtype: string | Record<string, string>,
  runtimeVersion: string | undefined,
): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  const keep = (part: string) =>
    SUFFIX[typeof dtype === "string" ? dtype : (dtype[part] ?? "")] ?? null;
  for (const request of await cache.keys()) {
    const url = request.url;
    const hf = HF_FILE.exec(url);
    if (hf && hf[1] === modelId) {
      const file = ONNX_PART.exec(hf[2]);
      if (!file) continue;
      const wanted = keep(file[1]);
      // An unknown dtype gives no suffix to compare with: keep everything.
      if (wanted !== null && (file[2] ?? "") !== wanted) await cache.delete(request);
      continue;
    }
    const runtime = RUNTIME_FILE.exec(url);
    if (runtime && runtimeVersion && runtime[1] !== runtimeVersion) await cache.delete(request);
  }
}
