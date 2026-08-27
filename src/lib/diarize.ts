// Merge pyannote speaker-turn segments onto Whisper's timestamped chunks.
import type { SpeakerSegment, TranscriptChunk } from "./protocol";

// The diarization model has no internal chunking of its own (unlike Whisper),
// so the worker splits audio into fixed windows before running it — verified
// empirically: 60 min in one pass succeeds, 67+ min reliably crashes the
// browser's WASM runtime. 20 min per window leaves a comfortable margin for
// lower-memory devices.
export const DIARIZE_WINDOW_MINUTES = 20;
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
