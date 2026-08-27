// Message protocol between the UI thread and the Whisper Web Worker.
import type { Backend, Dtype } from "./models";

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number | null];
  /** 1-based speaker index, assigned by speaker separation. Null if not run. */
  speaker?: number | null;
}

export interface TranscriptResult {
  text: string;
  chunks: TranscriptChunk[];
}

/** A single speaker turn, as returned by the pyannote segmentation model. */
export interface SpeakerSegment {
  id: number;
  start: number;
  end: number;
  confidence: number;
}

// ── UI → Worker ────────────────────────────────────────────────────────────
export type ToWorker =
  | {
      type: "load";
      modelId: string;
      dtype: Dtype;
      device: Backend;
    }
  | {
      type: "transcribe";
      jobId: string;
      audio: Float32Array;
      /** ISO language code (e.g. "sv") or null to auto-detect. */
      language: string | null;
      task: "transcribe" | "translate";
    }
  | {
      type: "diarize";
      jobId: string;
      audio: Float32Array;
    };

// ── Worker → UI ────────────────────────────────────────────────────────────
/** A raw onnxruntime/transformers download-progress event. */
export interface FileProgress {
  status: "initiate" | "download" | "progress" | "done";
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

export type FromWorker =
  | { type: "download"; data: FileProgress }
  | {
      type: "ready";
      modelId: string;
      dtype: Dtype;
      device: Backend;
    }
  | {
      // The worker may downgrade webgpu → wasm if the GPU fails to initialise.
      type: "device-fallback";
      from: Backend;
      to: Backend;
      reason: string;
    }
  | { type: "transcribe-start"; jobId: string }
  | { type: "transcribe-progress"; jobId: string; progress: number }
  | { type: "result"; jobId: string; result: TranscriptResult }
  | { type: "diarize-progress"; jobId: string; progress: number }
  | { type: "diarize-result"; jobId: string; segments: SpeakerSegment[] }
  | { type: "error"; jobId?: string; message: string };
