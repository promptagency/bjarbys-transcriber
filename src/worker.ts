/// <reference lib="webworker" />
import {
  pipeline,
  env,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type PreTrainedModel,
  type Processor,
  type WhisperTokenizer,
} from "@huggingface/transformers";
import { DIARIZE_WINDOW_SECONDS } from "./lib/diarize";
import type { Backend, Dtype } from "./lib/models";
import type {
  FileProgress,
  FromWorker,
  SpeakerSegment,
  ToWorker,
  TranscriptResult,
} from "./lib/protocol";

// Only ever fetch models from the Hugging Face Hub (avoids spurious local 404s).
env.allowLocalModels = false;

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = "";

// How long audio is chunked (see the `transcribe` handler below). Whisper
// processes each window independently, so estimating whole-file progress
// needs to know how far each window advances into the audio.
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;
const WINDOW_JUMP_S = CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S;

// ── Speaker separation (pyannote segmentation-3.0) ──────────────────────────
// A tiny (~1.5 MB), separate model used only to detect *who* is speaking when.
// It has nothing to do with Whisper and is loaded lazily, once, on WASM — it's
// small enough that there's no need for the dtype/device tiers ASR gets.
const DIARIZATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

// `Processor`'s public type doesn't declare the PyAnnote-only
// post_process_speaker_diarization helper — pin the exact shape we use.
type DiarizationProcessor = Processor & {
  post_process_speaker_diarization: (
    logits: unknown,
    numSamples: number,
  ) => SpeakerSegment[][];
  readonly sampling_rate: number;
};

let diarizer: { model: PreTrainedModel; processor: DiarizationProcessor } | null =
  null;

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
): (localSec: number) => void {
  let windowIndex = 0;
  let lastLocal = 0;
  return (localSec: number) => {
    if (localSec + 0.5 < lastLocal) windowIndex += 1;
    lastLocal = localSec;
    const globalSec = windowIndex * WINDOW_JUMP_S + localSec;
    const progress = durationSec > 0 ? globalSec / durationSec : 0;
    post({
      type: "transcribe-progress",
      jobId,
      progress: Math.min(0.99, Math.max(0, progress)),
    });
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

// Whisper's encoder is VERY sensitive to quantization on the WebGPU backend:
// anything below fp32 (fp16/q4f16/q4) makes base+ models emit a single token
// then stop (verified empirically — only tiny survives 4-bit). So on WebGPU we
// pin the encoder to fp32 and 4-bit only the (large) decoder — the exact config
// the official transformers.js Whisper examples use. On WASM a single integer
// dtype works fine. (transformers.js issue #1317 + dtypes guide.)
function resolveDtype(dtype: Dtype, device: Backend): DtypeArg {
  if (device === "webgpu") {
    if (dtype === "fp32") return "fp32";
    // Our "Balanced (GPU)" tier:
    return { encoder_model: "fp32", decoder_model_merged: "q4" };
  }
  return dtype; // WASM/CPU: q8 (default), q4, or fp32
}

async function build(
  modelId: string,
  dtype: Dtype,
  device: Backend,
): Promise<AutomaticSpeechRecognitionPipeline> {
  return await createPipeline("automatic-speech-recognition", modelId, {
    device,
    dtype: resolveDtype(dtype, device),
    progress_callback: (data: unknown) =>
      post({ type: "download", data: data as FileProgress }),
  });
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

  try {
    pipe = await build(modelId, dtype, device);
    loadedKey = key;
    return pipe;
  } catch (err) {
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
      return pipe;
    }
    throw err;
  }
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
      post({ type: "transcribe-start", jobId: msg.jobId });

      const samplingRate =
        pipe.processor.feature_extractor?.config.sampling_rate ?? 16000;
      const durationSec = msg.audio.length / samplingRate;
      const reportProgress = makeProgressReporter(msg.jobId, durationSec);
      const streamer = new WhisperTextStreamer(
        pipe.tokenizer as WhisperTokenizer,
        { on_chunk_start: reportProgress, on_chunk_end: reportProgress },
      );

      const output = (await pipe(msg.audio, {
        chunk_length_s: CHUNK_LENGTH_S,
        stride_length_s: STRIDE_LENGTH_S,
        return_timestamps: true,
        streamer,
        ...(msg.language
          ? { language: msg.language, task: msg.task }
          : {}),
      })) as { text: string; chunks?: TranscriptResult["chunks"] };

      const result: TranscriptResult = {
        text: output.text ?? "",
        chunks: output.chunks ?? [],
      };
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
    try {
      const { model, processor } = await ensureDiarizer();
      const sampleRate = processor.sampling_rate;
      const windowSamples = Math.round(DIARIZE_WINDOW_SECONDS * sampleRate);
      const numWindows = Math.max(
        1,
        Math.ceil(msg.audio.length / windowSamples),
      );

      // The model has no chunking of its own and crashes on very long audio
      // (verified empirically), so windows are diarized independently here.
      // Raw speaker ids are only meaningful *within* a window, so they're
      // namespaced per window — speaker identity is expected to reset at
      // window boundaries (no cross-window matching in this scope).
      const allSegments: SpeakerSegment[] = [];
      for (let w = 0; w < numWindows; w++) {
        const start = w * windowSamples;
        const end = Math.min(msg.audio.length, start + windowSamples);
        const windowAudio = msg.audio.subarray(start, end);
        const windowStartSec = start / sampleRate;

        const inputs = await processor(windowAudio);
        const { logits } = await model(inputs);
        const [segments] = processor.post_process_speaker_diarization(
          logits,
          windowAudio.length,
        );
        for (const seg of segments) {
          allSegments.push({
            id: w * 1000 + seg.id,
            start: seg.start + windowStartSec,
            end: seg.end + windowStartSec,
            confidence: seg.confidence,
          });
        }
        post({
          type: "diarize-progress",
          jobId: msg.jobId,
          progress: (w + 1) / numWindows,
        });
      }
      post({ type: "diarize-result", jobId: msg.jobId, segments: allSegments });
    } catch (err) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: String((err as Error)?.message ?? err),
      });
    }
    return;
  }
});
