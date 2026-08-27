import type { TranscriptResult } from "./protocol";

export type JobSource = "file" | "mic" | "podcast";

export type JobStatus =
  | "queued"
  | "fetching"
  | "decoding"
  | "transcribing"
  | "diarizing"
  | "done"
  | "error";

export interface Job {
  id: string;
  label: string;
  source: JobSource;
  status: JobStatus;
  /** 0..1 progress for the fetch/decode stage. */
  stageProgress: number;
  result: TranscriptResult | null;
  error: string | null;
  /** Non-fatal issue with an otherwise-successful result (e.g. speaker separation failed or was skipped). */
  warning: string | null;
  /** Base filename used when exporting (without extension is fine). */
  downloadName: string;
  /** Lazily acquire + decode this job's audio to mono 16 kHz PCM. */
  getAudio: (onProgress?: (p: number) => void) => Promise<Float32Array>;
}

export interface JobInput {
  label: string;
  source: JobSource;
  downloadName: string;
  getAudio: (onProgress?: (p: number) => void) => Promise<Float32Array>;
}

let counter = 0;
export function makeJob(input: JobInput): Job {
  counter += 1;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${counter}`;
  return {
    id,
    label: input.label,
    source: input.source,
    status: "queued",
    stageProgress: 0,
    result: null,
    error: null,
    warning: null,
    downloadName: input.downloadName,
    getAudio: input.getAudio,
  };
}

export const ACTIVE_STATUSES: JobStatus[] = [
  "fetching",
  "decoding",
  "transcribing",
  "diarizing",
];

/** Ordered pipeline stages this job passes through, given current settings. */
export function stagesFor(job: Job, diarizeEnabled: boolean): JobStatus[] {
  const stages: JobStatus[] = [];
  if (job.source === "podcast") stages.push("fetching");
  stages.push("decoding", "transcribing");
  if (diarizeEnabled) stages.push("diarizing");
  return stages;
}

/**
 * Rough 0..1 estimate of how far a job has progressed through its whole
 * pipeline, not just its current stage — each stage counts equally, and the
 * current stage contributes its own `stageProgress` within that share.
 */
export function jobProgress(job: Job, diarizeEnabled: boolean): number {
  if (job.status === "done" || job.status === "error") return 1;
  const stages = stagesFor(job, diarizeEnabled);
  const index = stages.indexOf(job.status);
  if (index === -1) return 0; // "queued"
  return (index + job.stageProgress) / stages.length;
}
