import type { SpeakerNames } from "./exporters";
import type { SavedTranscript } from "./storage";
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
  /**
   * Whether this job includes a speaker-separation stage. Fixed when the job
   * starts (and cleared if the recording is too long), so toggling the
   * setting mid-job can't change how far along the job appears to be.
   */
  willDiarize: boolean;
  /**
   * Names the user gave this transcript's speakers. Per job, because
   * "Speaker 1" is a different person in every recording.
   */
  speakerNames: SpeakerNames;
  /** Base filename used when exporting (without extension is fine). */
  downloadName: string;
  /** Lazily acquire this job's original audio/video (a podcast is downloaded here). */
  getMedia: (onProgress?: (p: number) => void) => Promise<Blob>;
  /**
   * The original media once acquired — kept so the review view can play back
   * individual lines. For files and recordings it's the object the page
   * already holds, so keeping it costs no extra memory.
   */
  media: Blob | null;
  /** The transcript as produced, before any manual edits, for reverting lines. */
  originalResult: TranscriptResult | null;
  /** Brought back from storage after a reload — its media is gone. */
  restored: boolean;
}

export interface JobInput {
  label: string;
  source: JobSource;
  downloadName: string;
  getMedia: (onProgress?: (p: number) => void) => Promise<Blob>;
}

let counter = 0;
export function makeJob(input: JobInput): Job {
  counter += 1;
  // randomUUID only exists in secure contexts (not plain http on a LAN IP).
  // Ids are persisted, so the fallback must not repeat across page loads —
  // a bare counter would restart at 1 and collide with restored transcripts.
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    label: input.label,
    source: input.source,
    status: "queued",
    stageProgress: 0,
    result: null,
    error: null,
    warning: null,
    willDiarize: false,
    speakerNames: {},
    downloadName: input.downloadName,
    getMedia: input.getMedia,
    media: null,
    originalResult: null,
    restored: false,
  };
}

export const ACTIVE_STATUSES: JobStatus[] = [
  "fetching",
  "decoding",
  "transcribing",
  "diarizing",
];

/** Ordered pipeline stages this job passes through. */
export function stagesFor(job: Job): JobStatus[] {
  const stages: JobStatus[] = [];
  if (job.source === "podcast") stages.push("fetching");
  stages.push("decoding", "transcribing");
  if (job.willDiarize) stages.push("diarizing");
  return stages;
}

/**
 * Rough 0..1 estimate of how far a job has progressed through its whole
 * pipeline, not just its current stage — each stage counts equally, and the
 * current stage contributes its own `stageProgress` within that share.
 */
export function jobProgress(job: Job): number {
  if (job.status === "done" || job.status === "error") return 1;
  const stages = stagesFor(job);
  const index = stages.indexOf(job.status);
  if (index === -1) return 0; // "queued"
  return (index + job.stageProgress) / stages.length;
}

/** A finished job rebuilt from storage. It has no media, so nothing can re-run it. */
export function jobFromSaved(saved: SavedTranscript): Job {
  return {
    id: saved.id,
    label: saved.label,
    source: saved.source,
    status: "done",
    stageProgress: 1,
    result: saved.result,
    error: null,
    warning: saved.warning,
    willDiarize: false,
    speakerNames: saved.speakerNames ?? {},
    downloadName: saved.downloadName,
    getMedia: () =>
      Promise.reject(new Error("The original audio isn't kept after a reload.")),
    media: null,
    originalResult: saved.originalResult,
    restored: true,
  };
}
