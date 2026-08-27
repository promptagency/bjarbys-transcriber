// Merge pyannote speaker-turn segments onto Whisper's timestamped chunks.
import type { SpeakerSegment, TranscriptChunk } from "./protocol";

// The diarization model has no internal chunking of its own (unlike Whisper),
// so the worker splits audio into fixed windows before running it — verified
// empirically: 60 min in one pass succeeds, 67+ min reliably crashes the
// browser's WASM runtime. Each window boundary also resets speaker identity
// (the model has no cross-window matching), so the window is kept as large
// as safely possible — 50 min, with margin for lower-memory devices — rather
// than small: most recordings need no windowing at all this way.
export const DIARIZE_WINDOW_MINUTES = 50;
export const DIARIZE_WINDOW_SECONDS = DIARIZE_WINDOW_MINUTES * 60;

// With windowing, duration no longer risks a crash — this is just a sanity
// ceiling against pathological uploads (each window costs ~10-15s to
// diarize, so even this takes a couple of minutes).
export const MAX_DIARIZE_MINUTES = 240;
export const MAX_DIARIZE_SECONDS = MAX_DIARIZE_MINUTES * 60;

/**
 * Assign a 1-based speaker index to each chunk, picking whichever segment
 * overlaps it the most. The model's raw segment ids are small but
 * non-sequential (e.g. 0, 2, 3), so they're remapped to 1, 2, 3... in the
 * order speakers first appear.
 */
export function assignSpeakers(
  chunks: TranscriptChunk[],
  segments: SpeakerSegment[],
): TranscriptChunk[] {
  if (segments.length === 0) return chunks;

  const seenRawIds: number[] = [];
  function speakerFor(start: number, end: number): number | null {
    let best: SpeakerSegment | null = null;
    let bestOverlap = 0;
    for (const seg of segments) {
      const overlap = Math.min(end, seg.end) - Math.max(start, seg.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = seg;
      }
    }
    if (!best) return null;
    let index = seenRawIds.indexOf(best.id);
    if (index === -1) {
      index = seenRawIds.length;
      seenRawIds.push(best.id);
    }
    return index + 1;
  }

  return chunks.map((chunk) => {
    const [start, end] = chunk.timestamp;
    return { ...chunk, speaker: speakerFor(start, end ?? Infinity) };
  });
}

// Brief overlapping speech or backchannels ("mhm") are often misclassified
// by the model as a distinct extra speaker for a moment. A short run
// sandwiched between two identical-speaker runs is almost always this, not
// a real third speaker, so it's folded into the surrounding one.
const SMOOTH_MAX_RUN_SECONDS = 2.5;

interface SpeakerRun {
  speaker: number | null | undefined;
  startIndex: number;
  endIndex: number;
  durationSec: number;
}

function runsOf(chunks: TranscriptChunk[]): SpeakerRun[] {
  const runs: SpeakerRun[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const speaker = chunks[i].speaker;
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker) {
      last.endIndex = i;
    } else {
      runs.push({ speaker, startIndex: i, endIndex: i, durationSec: 0 });
    }
  }
  for (const run of runs) {
    const start = chunks[run.startIndex].timestamp[0];
    const end = chunks[run.endIndex].timestamp[1] ?? start;
    run.durationSec = end - start;
  }
  return runs;
}

/**
 * Merge short, isolated speaker runs into their surrounding speaker when
 * both neighboring runs agree. Only touches runs bounded on both sides by
 * the same speaker — never guesses between two different neighbors.
 */
export function smoothSpeakers(chunks: TranscriptChunk[]): TranscriptChunk[] {
  const runs = runsOf(chunks);
  const result = chunks.map((c) => ({ ...c }));

  for (let i = 1; i < runs.length - 1; i++) {
    const prev = runs[i - 1];
    const cur = runs[i];
    const next = runs[i + 1];
    if (
      cur.durationSec < SMOOTH_MAX_RUN_SECONDS &&
      prev.speaker != null &&
      prev.speaker === next.speaker &&
      cur.speaker !== prev.speaker
    ) {
      for (let idx = cur.startIndex; idx <= cur.endIndex; idx++) {
        result[idx].speaker = prev.speaker;
      }
    }
  }
  return result;
}
