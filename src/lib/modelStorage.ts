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

/**
 * Tells this page's other tabs (and windows, and this tab's own worker or
 * page) that stored files changed, so their Storage lists don't go stale.
 */
const CHANNEL = "vem-sa-vad-model-storage";

export function announceStorageChanged(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("changed");
  channel.close();
}

/** Calls `listener` whenever another tab, window or worker announces a change. Returns an unsubscribe. */
export function onStorageChanged(listener: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}

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

/** The model cache, null if there is none yet; throws if storage can't be read at all. */
async function openCache(): Promise<Cache | null> {
  // has() first, so merely looking doesn't create an empty cache.
  return (await caches.has(MODEL_CACHE)) ? await caches.open(MODEL_CACHE) : null;
}

/**
 * A stored file's size. Model files carry their real size in content-length
 * (Transformers.js sets it), but the runtime is stored with the network's own
 * headers — compressed, so its content-length is the compressed size, or
 * missing. Those are measured from the body instead (a couple of files).
 */
async function storedSize(response: Response | undefined): Promise<number> {
  if (!response) return 0;
  const length = Number(response.headers.get("content-length"));
  if (length && !response.headers.get("content-encoding")) return length;
  try {
    return (await response.blob()).size;
  } catch {
    return length || 0;
  }
}

/**
 * Everything downloaded, grouped per model, largest first. Null when the
 * browser doesn't let the page read its storage (no Cache Storage, or it is
 * blocked); empty when nothing is stored.
 */
export async function listStored(): Promise<StoredGroup[] | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await openCache();
    if (!cache) return [];
    const groups = new Map<string, StoredGroup>();
    for (const request of await cache.keys()) {
      const id = groupOf(request.url);
      if (!id) continue;
      const bytes = await storedSize(await cache.match(request));
      const group = groups.get(id) ?? { id, bytes: 0, files: 0 };
      group.bytes += bytes;
      group.files += 1;
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  } catch {
    return null;
  }
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
  await caches.delete(MODEL_CACHE);
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

type DtypeArg = string | Record<string, string>;

/**
 * Delete what a successful load made redundant: quantizations of `modelId`'s
 * encoder and decoder that none of `keep` uses, and ONNX runtimes other than
 * `runtimeVersion`. `keep` holds the dtype just loaded plus the other
 * backend's defaults — a model can legitimately run on the GPU in one session
 * and the CPU in the next, and deleting either set would mean downloading it
 * again. Only call this when the load used the dtype first asked for: after a
 * fallback the preferred files may still be wanted next time.
 */
export async function pruneAfterLoad(
  modelId: string,
  keep: DtypeArg[],
  runtimeVersion: string | undefined,
): Promise<void> {
  const cache = await openCache(); // throws if storage is blocked; the worker ignores that
  if (!cache) return;
  // The file suffixes each part may keep. An unknown dtype gives no suffix to
  // compare with, so that part is left alone entirely.
  const allowed = (part: string): Set<string> | null => {
    const suffixes = new Set<string>();
    for (const dtype of keep) {
      const suffix = SUFFIX[typeof dtype === "string" ? dtype : (dtype[part] ?? "")];
      if (suffix === undefined) return null;
      suffixes.add(suffix);
    }
    return suffixes;
  };
  const allowedFor = {
    encoder_model: allowed("encoder_model"),
    decoder_model_merged: allowed("decoder_model_merged"),
  };
  for (const request of await cache.keys()) {
    const url = request.url;
    const hf = HF_FILE.exec(url);
    if (hf && hf[1] === modelId) {
      const file = ONNX_PART.exec(hf[2]);
      if (!file) continue;
      const suffixes = allowedFor[file[1] as keyof typeof allowedFor];
      if (suffixes && !suffixes.has(file[2] ?? "")) await cache.delete(request);
      continue;
    }
    const runtime = RUNTIME_FILE.exec(url);
    if (runtime && runtimeVersion && runtime[1] !== runtimeVersion) await cache.delete(request);
  }
}
