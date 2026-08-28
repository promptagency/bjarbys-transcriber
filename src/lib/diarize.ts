// Merge per-speaker activity spans onto Whisper's timestamped chunks.
import type { SpeakerActivity, TranscriptChunk } from "./protocol";

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

// pyannote 3.x emits a POWERSET, not one class per speaker: each of the 7
// classes is the *set* of locally-indexed speakers active in that frame.
//   0 = nobody   1/2/3 = one speaker   4/5/6 = two speaking at once
// So the class index is NOT a speaker id. Treating it as one (which is what
// the library's post_process_speaker_diarization helper does) turns silence
// into a speaker and turns overlapping speech into a phantom extra speaker —
// measured at 23% of a real two-person interview. Decode to per-speaker
// activity instead.
export const POWERSET: readonly (readonly number[])[] = [
  [], [0], [1], [2], [0, 1], [0, 2], [1, 2],
];
/** The model can represent at most this many distinct speakers per pass. */
export const MAX_LOCAL_SPEAKERS = 3;

/**
 * Turn raw frame logits into per-speaker active spans.
 *
 * Reads the flat tensor directly rather than via `.tolist()` — an hour of
 * audio is ~240k frames, and boxing that into nested JS arrays costs far more
 * memory than the browser has to spare here.
 */
export function decodeActivity(
  logitsData: Float32Array,
  numFrames: number,
  numClasses: number,
  durationSec: number,
  windowStartSec: number,
  windowIndex: number,
): SpeakerActivity[] {
  const secondsPerFrame = numFrames > 0 ? durationSec / numFrames : 0;
  const out: SpeakerActivity[] = [];
  // Start frame of each speaker's currently-open span, or -1 when inactive.
  const openFrom: number[] = new Array(MAX_LOCAL_SPEAKERS).fill(-1);

  const close = (speaker: number, endFrame: number) => {
    const from = openFrom[speaker];
    if (from < 0) return;
    out.push({
      speaker: windowIndex * MAX_LOCAL_SPEAKERS + speaker,
      start: windowStartSec + from * secondsPerFrame,
      end: windowStartSec + endFrame * secondsPerFrame,
    });
    openFrom[speaker] = -1;
  };

  const active: boolean[] = new Array(MAX_LOCAL_SPEAKERS).fill(false);
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * numClasses;
    let bestClass = 0;
    let bestScore = logitsData[offset];
    for (let k = 1; k < numClasses; k++) {
      if (logitsData[offset + k] > bestScore) {
        bestScore = logitsData[offset + k];
        bestClass = k;
      }
    }

    active.fill(false);
    for (const speaker of POWERSET[bestClass] ?? []) active[speaker] = true;

    for (let s = 0; s < MAX_LOCAL_SPEAKERS; s++) {
      if (active[s] && openFrom[s] < 0) openFrom[s] = frame;
      else if (!active[s] && openFrom[s] >= 0) close(s, frame);
    }
  }
  for (let s = 0; s < MAX_LOCAL_SPEAKERS; s++) close(s, numFrames);

  return out;
}

/**
 * Attributions at or below this margin are treated as uncertain — usually
 * because two people are talking across the chunk, not because the answer is
 * wrong. Consumers can filter on `speaker_conf` instead of guessing.
 */
export const LOW_CONFIDENCE = 0.35;

/**
 * End time of chunk `i`.
 *
 * Whisper may leave a trailing segment's end open (`timestamp[1]` is nullable),
 * so fall back to where the next chunk starts. Neither obvious shortcut works:
 * treating the span as zero-width overlaps nothing and silently drops the
 * attribution, while treating it as unbounded hands the chunk to whoever speaks
 * most through the entire rest of the recording.
 */
function chunkEnd(
  chunks: TranscriptChunk[],
  i: number,
  fallback?: number,
): number {
  const start = chunks[i].timestamp[0];
  const explicit = chunks[i].timestamp[1];
  if (explicit != null) return explicit;
  return Math.max(start, chunks[i + 1]?.timestamp[0] ?? fallback ?? start);
}

/**
 * Typical chunk length, used to bound a trailing chunk whose end is unknown.
 *
 * Without a bound, a transcript that Whisper truncated early (a repetition-loop
 * cutoff, say) would stretch its final chunk across every remaining minute of
 * speech and attribute it to whoever dominates that span.
 */
function typicalChunkSeconds(chunks: TranscriptChunk[]): number {
  const spans = chunks
    .filter((c) => c.timestamp[1] != null)
    .map((c) => (c.timestamp[1] as number) - c.timestamp[0])
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (spans.length === 0) return 5;
  return spans[Math.floor(spans.length / 2)];
}

/**
 * Assign each chunk the speaker who is active for the most of its duration.
 *
 * Weighted by total active time across the whole chunk rather than by a single
 * best-overlapping span: a speaker who holds the floor in three bursts should
 * beat one continuous interjection. Speakers can be active simultaneously, so
 * their spans legitimately overlap.
 */
export function assignSpeakers(
  chunks: TranscriptChunk[],
  activity: SpeakerActivity[],
): TranscriptChunk[] {
  if (activity.length === 0) return chunks;

  // Group spans by speaker, each list sorted by start time.
  const bySpeaker = new Map<number, SpeakerActivity[]>();
  for (const span of activity) {
    const list = bySpeaker.get(span.speaker);
    if (list) list.push(span);
    else bySpeaker.set(span.speaker, [span]);
  }
  for (const list of bySpeaker.values()) list.sort((a, b) => a.start - b.start);

  /** First index whose span could still overlap `from` (spans are sorted). */
  function firstCandidate(list: SpeakerActivity[], from: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].end <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Speakers are renumbered 1, 2, 3... in the order they first speak, so the
  // output stays readable regardless of the model's internal indices.
  const seenIds: number[] = [];

  // Bounds for a final chunk with an open end: never past the last speech, and
  // never longer than a typical utterance.
  const lastActivityEnd = activity.reduce((max, s) => Math.max(max, s.end), 0);
  const typicalSeconds = typicalChunkSeconds(chunks);

  return chunks.map((chunk, chunkIndex) => {
    const start = chunk.timestamp[0];
    const end = chunkEnd(
      chunks,
      chunkIndex,
      Math.min(lastActivityEnd, start + typicalSeconds),
    );

    let topId: number | null = null;
    let topTime = 0;
    let secondTime = 0;

    for (const [id, list] of bySpeaker) {
      let total = 0;
      for (let i = firstCandidate(list, start); i < list.length; i++) {
        const span = list[i];
        if (span.start >= end) break;
        total += Math.min(end, span.end) - Math.max(start, span.start);
      }
      if (total > topTime) {
        secondTime = topTime;
        topTime = total;
        topId = id;
      } else if (total > secondTime) {
        secondTime = total;
      }
    }

    // Nobody was speaking here — say so rather than inventing an attribution.
    if (topId === null || topTime <= 0) {
      return { ...chunk, speaker: null, speaker_conf: 0 };
    }

    let index = seenIds.indexOf(topId);
    if (index === -1) {
      index = seenIds.length;
      seenIds.push(topId);
    }
    const confidence = (topTime - secondTime) / topTime;
    return {
      ...chunk,
      speaker: index + 1,
      speaker_conf: Math.round(confidence * 100) / 100,
    };
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
    run.durationSec = chunkEnd(chunks, run.endIndex) - start;
  }
  return runs;
}

/**
 * Merge short, isolated speaker runs into their surrounding speaker when both
 * neighboring runs agree. Only touches runs bounded on both sides by the same
 * speaker — never guesses between two different neighbors.
 *
 * Only *low-confidence* runs are merged: if the model was clearly sure it
 * heard someone else for a moment, that's a real interjection and gets to
 * stand. Chunks with no detected speech are left alone rather than having
 * speech invented for them.
 */
export function smoothSpeakers(chunks: TranscriptChunk[]): TranscriptChunk[] {
  const runs = runsOf(chunks);
  const result = chunks.map((c) => ({ ...c }));

  for (let i = 1; i < runs.length - 1; i++) {
    const prev = runs[i - 1];
    const cur = runs[i];
    const next = runs[i + 1];
    if (cur.speaker == null) continue;
    const uncertain = chunks
      .slice(cur.startIndex, cur.endIndex + 1)
      .every((c) => (c.speaker_conf ?? 0) <= LOW_CONFIDENCE);
    if (
      cur.durationSec < SMOOTH_MAX_RUN_SECONDS &&
      uncertain &&
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
