/// <reference lib="webworker" />
import {
  pipeline,
  env,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  WhisperTextStreamer,
  Tensor,
  type AutomaticSpeechRecognitionPipeline,
  type PreTrainedModel,
  type Processor,
  type WhisperTokenizer,
} from "@huggingface/transformers";
import {
  DIARIZE_WINDOW_SECONDS,
  decodeActivity,
  planWindows,
  stitchWindows,
} from "./lib/diarize";
import { isEnglishOnly, type Backend, type Dtype } from "./lib/models";
import { pruneAfterLoad } from "./lib/modelStorage";
import type {
  FileProgress,
  FromWorker,
  SpeakerActivity,
  ToWorker,
  TranscriptResult,
} from "./lib/protocol";

// Only ever fetch models from the Hugging Face Hub (avoids spurious local 404s).
env.allowLocalModels = false;

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
/** Hub id of the loaded model — English-only models take no language or task. */
let loadedModelId = "";
let loadedKey = "";

// How long audio is chunked (see the `transcribe` handler below). Whisper
// processes each window independently, so estimating whole-file progress
// needs to know how far each window advances into the audio.
const CHUNK_LENGTH_S = 30;
// Overlap on each side of a window. Transformers.js's default (5 s, a sixth of
// the window) sometimes failed to merge the doubly-transcribed overlap and
// repeated whole sentences; 2.5 s removed the repeats and did a third less
// work, while 0–1 s dropped words at the cuts. See docs/benchmark.md.
const STRIDE_LENGTH_S = 2.5;


// ── Speaker separation (pyannote segmentation-3.0) ──────────────────────────
// A tiny (~1.5 MB), separate model used only to detect *who* is speaking when.
// It has nothing to do with Whisper and is loaded lazily, once, on WASM — it's
// small enough that there's no need for the dtype/device tiers ASR gets.
const DIARIZATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

type DiarizationProcessor = Processor & {
  readonly sampling_rate: number;
};

let diarizer: { model: PreTrainedModel; processor: DiarizationProcessor } | null =
  null;

// Audio kept back from a `transcribe` so the following `diarize` can reuse it.
// The queue runs one job at a time, so a single slot is enough — and holding
// only the newest bounds this to one recording's worth even if a job dies
// between the two messages.
let retainedAudio: { jobId: string; audio: Float32Array } | null = null;

async function ensureDiarizer(): Promise<{
  model: PreTrainedModel;
  processor: DiarizationProcessor;
}> {
  if (diarizer) return diarizer;
  const [model, processor] = await Promise.all([
    AutoModelForAudioFrameClassification.from_pretrained(
      DIARIZATION_MODEL_ID,
      { device: "wasm", dtype: "q8" },
    ),
    AutoProcessor.from_pretrained(DIARIZATION_MODEL_ID),
  ]);
  diarizer = { model, processor: processor as DiarizationProcessor };
  return diarizer;
}

/** Below this there is no point retrying — something other than size is wrong. */
const MIN_DIARIZE_WINDOW_SECONDS = 5 * 60;

async function disposeDiarizer(): Promise<void> {
  const current = diarizer;
  diarizer = null;
  try {
    await current?.model.dispose();
  } catch {
    /* already torn down by the abort */
  }
}

/** Diarize the whole recording in windows of at most `windowSec`. */
async function runDiarization(
  audio: Float32Array,
  windowSec: number,
  onProgress: (progress: number) => void,
): Promise<SpeakerActivity[]> {
  const { model, processor } = await ensureDiarizer();
  const sampleRate = processor.sampling_rate;

  // Speaker indices only carry meaning within a single pass, so stitchWindows()
  // matches them across each seam using the overlap. A recording shorter than
  // the window takes one pass and needs no matching.
  const windows = planWindows(audio.length / sampleRate, windowSec);
  const parts: { window: (typeof windows)[number]; activity: SpeakerActivity[] }[] =
    [];
  for (const window of windows) {
    const start = Math.round(window.startSec * sampleRate);
    const end = Math.min(audio.length, Math.round(window.endSec * sampleRate));
    const windowAudio = audio.subarray(start, end);

    const inputs = await processor(windowAudio);
    const { logits } = await model(inputs);
    const [, numFrames, numClasses] = logits.dims as number[];
    parts.push({
      window,
      activity: decodeActivity(
        logits.data as Float32Array,
        numFrames,
        numClasses,
        windowAudio.length / sampleRate,
        start / sampleRate,
        window.index,
      ),
    });
    onProgress((window.index + 1) / windows.length);
  }
  return stitchWindows(parts);
}

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function keyOf(modelId: string, dtype: Dtype, device: Backend): string {
  return `${modelId}|${dtype}|${device}`;
}

// If a WebGPU load fails, retry on WASM — and swap a GPU-only dtype for a
// CPU-friendly one (q4f16/fp16 don't belong on WASM; q8 is the safe default).
function wasmDtypeFor(dtype: Dtype): Dtype {
  return dtype === "q4f16" || dtype === "fp16" ? "q8" : dtype;
}

// WhisperTextStreamer reports timestamps *within* the current 30s window
// (they reset to ~0 at the start of each window), not whole-file position.
// A timestamp dropping instead of rising is our signal that a new window
// has started, which we use to reconstruct an approximate global position.
function makeProgressReporter(
  jobId: string,
  durationSec: number,
  strideS: number,
): (localSec: number) => void {
  const windowJumpS = CHUNK_LENGTH_S - 2 * strideS;
  let windowIndex = 0;
  let lastLocal = 0;
  return (localSec: number) => {
    if (localSec + 0.5 < lastLocal) windowIndex += 1;
    lastLocal = localSec;
    const globalSec = windowIndex * windowJumpS + localSec;
    const progress = durationSec > 0 ? globalSec / durationSec : 0;
    post({
      type: "transcribe-progress",
      jobId,
      progress: Math.min(0.99, Math.max(0, progress)),
    });
  };
}

// Live preview: the text so far, sent while a long file is still transcribing.
// Finished windows are merged the way the final result is — Transformers.js's
// _decode_asr over each window's token sequence, with the same strides — so
// that part reads as the finished transcript. The sequences come from the
// pipeline's own model.generate() call for each 30 s window (wrapped while a
// file is transcribed): with timestamps, Whisper's generate() runs an internal
// seek loop that may decode a window in several passes, so the streamer's
// per-pass ends are not windows. The window being transcribed is provisional:
// its streamed text is appended, minus a phrase repeating the merged text's end.
// To stay cheap on long files, only the most recent windows are re-merged and
// only the end of the text is sent; the full transcript arrives when done.
const PREVIEW_INTERVAL_MS = 250;
/** Windows re-merged after each one finishes (≈ 16 minutes of audio). */
const PREVIEW_MERGE_WINDOWS = 40;
/** The preview shows the end of the transcript, this many characters at most. */
const PREVIEW_MAX_CHARS = 20_000;

type AsrMerge = (
  chunks: { tokens: number[]; stride: [number, number, number] }[],
  options: { time_precision: number; return_timestamps: boolean; force_full_sequences: boolean },
) => [string, unknown];

const previewWords = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** `next` without leading words that repeat the end of `before` (up to 12). */
function dropRepeatedStart(before: string, next: string): string {
  const tail = previewWords(before).slice(-12);
  const head = next.trim().split(/\s+/);
  const headWords = head.map((w) => previewWords(w).join(""));
  for (let n = Math.min(tail.length, headWords.length); n > 0; n--) {
    if (tail.slice(-n).join(" ") === headWords.slice(0, n).join(" ")) return head.slice(n).join(" ");
  }
  return next.trim();
}

/** The last `max` characters of `text`, starting at a word. */
function tailOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

function makeLivePreview(
  p: AutomaticSpeechRecognitionPipeline,
  jobId: string,
  totalSamples: number,
  samplingRate: number,
  strideS: number,
) {
  const merge = (p.tokenizer as unknown as { _decode_asr: AsrMerge })._decode_asr.bind(p.tokenizer);
  const extractor = p.processor.feature_extractor?.config as { chunk_length?: number } | undefined;
  const maxSource = (p.model.config as { max_source_positions?: number }).max_source_positions;
  const timePrecision = (extractor?.chunk_length ?? 30) / (maxSource ?? 1500);
  const windowSamples = CHUNK_LENGTH_S * samplingRate;
  const jumpSamples = windowSamples - 2 * strideS * samplingRate;

  const windows: { tokens: number[]; stride: [number, number, number] }[] = [];
  let streamed = "";
  let merged = "";
  let lastPost = 0;

  const send = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastPost < PREVIEW_INTERVAL_MS) return;
    lastPost = now;
    const tail = merged ? dropRepeatedStart(merged, streamed) : streamed.trim();
    const text = tail ? `${merged} ${tail}`.trim() : merged;
    post({ type: "transcribe-partial", jobId, text: tailOf(text, PREVIEW_MAX_CHARS) });
  };

  return {
    /** Streamed text of the window in progress. */
    text(piece: string) {
      streamed += piece;
      send(false);
    },
    /** One pipeline window is done; `tokens` is the sequence its generate() returned. */
    window(tokens: number[]) {
      const index = windows.length;
      const start = index * jumpSamples;
      const isLast = start + windowSamples >= totalSamples;
      const length = Math.max(0, Math.min(windowSamples, totalSamples - start)) / samplingRate;
      windows.push({ tokens, stride: [length, index === 0 ? 0 : strideS, isLast ? 0 : strideS] });
      try {
        merged = merge(windows.slice(-PREVIEW_MERGE_WINDOWS), {
          time_precision: timePrecision,
          return_timestamps: true,
          force_full_sequences: false,
        })[0].trim();
      } catch {
        merged = `${merged} ${dropRepeatedStart(merged, streamed)}`.trim();
      }
      streamed = "";
      send(true);
    },
  };
}

// Cast away transformers.js's huge pipeline() overload union (TS2590) by
// pinning the exact signature we use.
const createPipeline = pipeline as unknown as (
  task: "automatic-speech-recognition",
  model: string,
  options: Record<string, unknown>,
) => Promise<AutomaticSpeechRecognitionPipeline>;

type DtypeArg = string | Record<string, string>;

// The "Balanced (GPU)" tier: fp16 encoder + q4f16 decoder (4-bit weights,
// 16-bit maths). 16-bit needs a GPU with `shader-f16`; without it we load the
// fp32 encoder + q4 decoder this app always used. Measured (see
// docs/webgpu-quantization.md): on transformers.js 3.x any 16-bit variant made Whisper
// emit garbage on WebGPU (4.x fixed that), and a 4-bit encoder — fine on clean
// Swedish — made the multilingual model drop speech after a language switch.
// Asked on every model load rather than cached: a passing failure (e.g. while
// the GPU process restarts) must not pin the larger fallback for the session.
async function hasShaderF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    return !!adapter?.features.has("shader-f16");
  } catch {
    return false;
  }
}

/** fp32 encoder + q4 decoder: the GPU tier without 16-bit maths. */
const GPU_NO_F16: DtypeArg = { encoder_model: "fp32", decoder_model_merged: "q4" };

async function resolveDtype(dtype: Dtype, device: Backend): Promise<DtypeArg> {
  if (device === "webgpu") {
    if (dtype === "fp32") return "fp32";
    // Our "Balanced (GPU)" tier:
    return (await hasShaderF16())
      ? { encoder_model: "fp16", decoder_model_merged: "q4f16" }
      : GPU_NO_F16;
  }
  return dtype; // WASM/CPU: q8 (default), q4, or fp32
}

async function build(
  modelId: string,
  dtype: Dtype,
  device: Backend,
  dtypeArg?: DtypeArg,
): Promise<AutomaticSpeechRecognitionPipeline> {
  return await createPipeline("automatic-speech-recognition", modelId, {
    device,
    dtype: dtypeArg ?? (await resolveDtype(dtype, device)),
    progress_callback: (data: unknown) =>
      post({ type: "download", data: data as FileProgress }),
  });
}

// Transformers.js has no language detection: given no language, it forces
// English, so "Auto-detect" used to mean "assume English" and Swedish came back
// translated. Whisper itself detects language as its first decoded token, so
// ask for that token once, on the first 30 s, and transcribe with the winner.
// One language per file: speech that switches language mid-file is
// transcribed as the language heard first.
async function detectLanguage(
  p: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array,
  samplingRate: number,
): Promise<string | null> {
  try {
    const model = p.model as unknown as {
      generation_config?: {
        lang_to_id?: Record<string, number>;
        decoder_start_token_id?: number;
      };
      (inputs: Record<string, unknown>): Promise<Record<string, Tensor>>;
    };
    const config = model.generation_config;
    if (!config?.lang_to_id || config.decoder_start_token_id == null) return null;
    const { input_features } = await (
      p.processor as unknown as (a: Float32Array) => Promise<{ input_features: Tensor }>
    )(audio.subarray(0, CHUNK_LENGTH_S * samplingRate));
    const outputs = await model({
      input_features,
      decoder_input_ids: new Tensor(
        "int64",
        BigInt64Array.of(BigInt(config.decoder_start_token_id)),
        [1, 1],
      ),
    });
    try {
      // A 16-bit decoder returns float16 logits; without Float16Array in the
      // browser those arrive as raw bits, so convert before comparing.
      const scores = outputs.logits.to("float32").data as Float32Array;
      let best: string | null = null;
      let bestScore = -Infinity;
      for (const [token, id] of Object.entries(config.lang_to_id)) {
        if (scores[id] > bestScore) {
          bestScore = scores[id];
          best = token.slice(2, -2); // "<|sv|>" → "sv"
        }
      }
      return best;
    } finally {
      // On WebGPU the decoder's key/value outputs stay on the GPU; generate()
      // frees them itself, but this direct call must, or every job leaks them.
      for (const tensor of Object.values(outputs)) {
        if (tensor?.location === "gpu-buffer") tensor.dispose();
      }
    }
  } catch {
    return null; // fall back to Transformers.js's own default
  }
}

async function ensurePipeline(
  modelId: string,
  dtype: Dtype,
  device: Backend,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = keyOf(modelId, dtype, device);
  if (pipe && key === loadedKey) return pipe;

  // Dispose any previously loaded model before switching.
  if (pipe) {
    try {
      await pipe.dispose();
    } catch {
      /* ignore */
    }
    pipe = null;
    loadedKey = "";
  }

  // Try the requested dtype twice before falling back. A failed first attempt
  // has been seen only intermittently (never reproduced under instrumentation;
  // most likely transient), and falling back costs a larger download and a
  // slower model — a second try is cheap by comparison.
  const dtypeArg = await resolveDtype(dtype, device);
  let firstError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      pipe = await build(modelId, dtype, device, dtypeArg);
      loadedKey = key;
      loadedModelId = modelId;
      // Loaded as first asked: other quantizations of this model, and older ONNX
      // runtimes, are now dead weight on disk. (Not after a fallback below — the
      // preferred files may well load next time.) Best effort, in the background.
      void pruneAfterLoad(modelId, dtypeArg, env.backends.onnx?.versions?.web)
        .then(() => post({ type: "storage-changed" }))
        .catch(() => {});
      return pipe;
    } catch (err) {
      firstError ??= err;
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const err = firstError;
  // If the 16-bit GPU variant fails to load, the 32-bit one may still work
  // on the GPU — far faster than dropping to the CPU.
  if (device === "webgpu" && dtype !== "fp32") {
    if (dtypeArg !== GPU_NO_F16) {
      try {
        pipe = await build(modelId, dtype, device, GPU_NO_F16);
        loadedKey = key;
        loadedModelId = modelId;
        return pipe;
      } catch {
        /* fall through to the CPU */
      }
    }
  }
  if (device === "webgpu") {
    const to: Backend = "wasm";
    const fallbackDtype = wasmDtypeFor(dtype);
    post({
      type: "device-fallback",
      from: "webgpu",
      to,
      reason: String((err as Error)?.message ?? err),
    });
    pipe = await build(modelId, fallbackDtype, to);
    loadedKey = keyOf(modelId, fallbackDtype, to);
    loadedModelId = modelId;
    return pipe;
  }
  throw err;
}

self.addEventListener("message", async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;

  if (msg.type === "load") {
    try {
      await ensurePipeline(msg.modelId, msg.dtype, msg.device);
      const [, dtype, device] = loadedKey.split("|");
      post({
        type: "ready",
        modelId: msg.modelId,
        dtype: dtype as Dtype,
        device: device as Backend,
      });
    } catch (err) {
      post({ type: "error", message: String((err as Error)?.message ?? err) });
    }
    return;
  }

  if (msg.type === "transcribe") {
    try {
      if (!pipe) throw new Error("Model is not loaded yet.");
      // Whatever the previous job left behind is dead weight now.
      retainedAudio = null;
      post({ type: "transcribe-start", jobId: msg.jobId });

      const samplingRate =
        pipe.processor.feature_extractor?.config.sampling_rate ?? 16000;
      const durationSec = msg.audio.length / samplingRate;
      const englishOnly = isEnglishOnly(loadedModelId);
      const detected =
        !msg.language && !englishOnly
          ? await detectLanguage(pipe, msg.audio, samplingRate)
          : null;
      const language = msg.language ?? detected;
      const strideS = msg.strideS ?? STRIDE_LENGTH_S;
      const reportProgress = makeProgressReporter(msg.jobId, durationSec, strideS);
      const preview = makeLivePreview(pipe, msg.jobId, msg.audio.length, samplingRate, strideS);
      const streamer = new WhisperTextStreamer(pipe.tokenizer as WhisperTokenizer, {
        on_chunk_start: reportProgress,
        on_chunk_end: reportProgress,
        callback_function: preview.text,
      });
      // The pipeline calls model.generate() once per window; its result is the
      // exact sequence the final merge uses (see makeLivePreview).
      // Shadowed on the instance for this file only, and removed afterwards
      // even on failure, so the next job doesn't wrap a wrapper.
      const model = pipe.model as unknown as { generate: (args: unknown) => Promise<unknown> };
      const generate = model.generate;
      const ownGenerate = Object.prototype.hasOwnProperty.call(model, "generate");
      model.generate = async (args: unknown) => {
        const out = (await generate.call(model, args)) as { tolist(): unknown[][] };
        try {
          preview.window((out.tolist()[0] as (number | bigint)[]).map(Number));
        } catch {
          /* the preview is a nicety — never fail the transcription over it */
        }
        return out;
      };

      let output: { text: string; chunks?: TranscriptResult["chunks"] };
      try {
        output = (await pipe(msg.audio, {
          chunk_length_s: CHUNK_LENGTH_S,
          stride_length_s: strideS,
          return_timestamps: true,
          streamer,
          // English-only models have neither a language nor a task token.
          ...(englishOnly ? {} : { task: msg.task, ...(language ? { language } : {}) }),
        })) as { text: string; chunks?: TranscriptResult["chunks"] };
      } finally {
        if (ownGenerate) model.generate = generate;
        else delete (model as { generate?: unknown }).generate;
      }
      const result: TranscriptResult = {
        text: output.text ?? "",
        chunks: output.chunks ?? [],
        ...(detected ? { language: detected } : {}),
      };
      if (msg.retainAudio) retainedAudio = { jobId: msg.jobId, audio: msg.audio };
      post({ type: "result", jobId: msg.jobId, result });
    } catch (err) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: String((err as Error)?.message ?? err),
      });
    }
    return;
  }

  if (msg.type === "diarize") {
    const audio =
      retainedAudio?.jobId === msg.jobId ? retainedAudio.audio : null;
    retainedAudio = null;
    if (!audio) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: "Audio for this job is no longer available in the worker.",
      });
      return;
    }
    // How much audio fits in one pass depends on the device and on how much
    // the loaded Whisper model has already claimed — a 48-minute file failed
    // with kb-whisper-small resident but not with a smaller model. No fixed
    // window can be right for every combination, so on failure the window is
    // halved and the whole run retried.
    let windowSec = DIARIZE_WINDOW_SECONDS;
    let lastError: unknown = null;
    // A retry starts the pass over; holding progress at its high-water mark
    // keeps the bar from jumping back to zero while it catches up.
    let reported = 0;
    const report = (progress: number) => {
      if (progress <= reported) return;
      reported = progress;
      post({ type: "diarize-progress", jobId: msg.jobId, progress });
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        post({
          type: "diarize-result",
          jobId: msg.jobId,
          activity: await runDiarization(audio, windowSec, report),
        });
        return;
      } catch (err) {
        lastError = err;
        // An out-of-memory abort leaves the WASM runtime unusable, so the
        // retry needs a fresh session rather than the poisoned one.
        await disposeDiarizer();
        windowSec = Math.round(windowSec / 2);
        if (windowSec < MIN_DIARIZE_WINDOW_SECONDS) break;
      }
    }
    // A raw memory address rather than a message means a WASM abort, which is
    // almost always memory. Say something the user can act on.
    const raw = String((lastError as Error)?.message ?? lastError);
    post({
      type: "error",
      jobId: msg.jobId,
      message: /^\d+$/.test(raw)
        ? `Not enough memory for speaker separation, even in ${Math.round(
            (windowSec * 2) / 60,
          )}-minute chunks. A smaller Whisper model leaves more room for it.`
        : raw,
    });
    return;
  }
});
