// Merge pyannote speaker-turn segments onto Whisper's timestamped chunks.
import type { SpeakerSegment, TranscriptChunk } from "./protocol";

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
