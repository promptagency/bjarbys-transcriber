import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import type { Job } from "../lib/jobs";
import type { TranscriptChunk } from "../lib/protocol";
import { LOW_CONFIDENCE } from "../lib/diarize";
import { speakerLabel, speakersIn } from "../lib/exporters";

/** A chunk with no end timestamp plays up to the next chunk, or this long. */
const FALLBACK_PLAY_SECONDS = 5;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Lines the model wasn't sure about: a low margin between the top two
 * speakers, or no speaker found at all in a transcript that has speakers.
 * A line the user has corrected is settled and no longer flagged.
 */
function isUnsure(chunk: TranscriptChunk, hasSpeakers: boolean): boolean {
  if (!hasSpeakers || chunk.edited) return false;
  if (chunk.speaker == null) return true;
  return (chunk.speaker_conf ?? 1) <= LOW_CONFIDENCE;
}

/**
 * The transcript as a list of lines that can be checked and corrected: play a
 * line's audio, change its speaker, edit its text, or revert the change.
 * Edits go into the job's result, so Copy and every export include them.
 */
export function TranscriptReview({
  job,
  onEdit,
  onRevert,
}: {
  job: Job;
  onEdit: (job: Job, index: number, patch: Partial<TranscriptChunk>) => void;
  onRevert: (job: Job, index: number) => void;
}) {
  const result = job.result!;
  const chunks = result.chunks;
  const allSpeakers = speakersIn(result, { includeBlank: true });
  const hasSpeakers = allSpeakers.length > 0;
  const speakers = speakersIn(result);

  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [playing, setPlaying] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!job.media) return;
    const url = URL.createObjectURL(job.media);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [job.media]);

  // Lines with no words are skipped, as in the exports — unless the user
  // cleared them, so the change stays visible and can be reverted.
  const rows = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => chunk.text.trim().length > 0 || chunk.edited);
  const unsureCount = rows.filter(({ chunk }) => isUnsure(chunk, hasSpeakers)).length;
  // Only while the toggle is visible: if every speaker is removed by hand the
  // checkbox disappears, and a filter left on would hide all lines for good.
  const shown = onlyUnsure && hasSpeakers
    ? rows.filter(({ chunk }) => isUnsure(chunk, hasSpeakers))
    : rows;

  function endOf(index: number): number {
    const chunk = chunks[index];
    const start = chunk.timestamp[0];
    return (
      chunk.timestamp[1] ??
      chunks[index + 1]?.timestamp[0] ??
      start + FALLBACK_PLAY_SECONDS
    );
  }

  function togglePlay(index: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === index) {
      audio.pause();
      return;
    }
    stopAt.current = endOf(index);
    audio.currentTime = chunks[index].timestamp[0];
    setPlaying(index);
    audio.play().catch(() => {
      setPlaying(null);
      setPlaybackError(true);
    });
  }

  function startEdit(index: number) {
    setEditing(index);
    setDraft(chunks[index].text.trim());
  }

  function saveEdit() {
    if (editing === null) return;
    const original = chunks[editing].text;
    // One line of text: a newline inside a subtitle cue (and a blank line in
    // particular, which ends the cue) would corrupt the .srt/.vtt exports.
    const after = draft.replace(/\s+/g, " ").trim();
    // Keep the chunk's own leading whitespace — Whisper puts a space there for
    // languages that use them, and none for those that don't — so the joined
    // full text reads the same as before.
    const lead = original.match(/^\s*/)?.[0] ?? "";
    if (after !== original.trim()) {
      onEdit(job, editing, { text: after ? lead + after : "" });
    }
    setEditing(null);
  }

  function setSpeaker(index: number, value: string) {
    let speaker: number | null;
    if (value === "none") speaker = null;
    // Counted over every speaker, including those only on blank lines, so a
    // new speaker can't silently reuse an existing number.
    else if (value === "new") speaker = Math.max(0, ...allSpeakers) + 1;
    else speaker = Number(value);
    onEdit(job, index, { speaker });
  }

  return (
    <div>
      {mediaUrl && (
        <audio
          ref={audioRef}
          src={mediaUrl}
          preload="metadata"
          onTimeUpdate={(e) => {
            if (playing !== null && e.currentTarget.currentTime >= stopAt.current) {
              e.currentTarget.pause();
            }
          }}
          onPause={() => setPlaying(null)}
          onEnded={() => setPlaying(null)}
          onError={() => setPlaybackError(true)}
          className="hidden"
        />
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        {hasSpeakers ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={onlyUnsure}
              onChange={(e) => setOnlyUnsure(e.target.checked)}
              className="size-3.5 accent-amber-500"
            />
            Only unsure lines ({unsureCount})
          </label>
        ) : (
          <span />
        )}
        {playbackError || !job.media ? (
          <span className="text-amber-300">
            Playback isn&rsquo;t available for this file in the browser.
          </span>
        ) : (
          <span>Click ▶ to hear a line · click text to edit it</span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          {onlyUnsure ? "No unsure lines left." : "(no speech detected)"}
        </p>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto pr-1 scroll-thin">
          {shown.map(({ chunk, index }) => {
            const unsure = isUnsure(chunk, hasSpeakers);
            const canPlay = !!job.media && !playbackError;
            return (
              <li
                key={index}
                className={`flex items-start gap-2 rounded-lg border-l-2 py-1.5 pl-2 pr-1 ${
                  unsure
                    ? "border-amber-400 bg-amber-400/[0.06]"
                    : "border-transparent hover:bg-white/[0.02]"
                }`}
              >
                <button
                  type="button"
                  title={playing === index ? "Stop" : "Play this line"}
                  disabled={!canPlay}
                  onClick={() => togglePlay(index)}
                  className="mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-white/5 hover:text-sky-300 disabled:opacity-30"
                >
                  {playing === index ? (
                    <Square className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </button>
                <span className="mt-1 w-10 shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                  {clock(chunk.timestamp[0])}
                </span>

                {hasSpeakers && (
                  <select
                    value={chunk.speaker == null ? "none" : String(chunk.speaker)}
                    onChange={(e) => setSpeaker(index, e.target.value)}
                    title={unsure ? "The model wasn't sure who said this" : "Speaker"}
                    className={`mt-0.5 w-28 shrink-0 truncate rounded border bg-[var(--color-surface-2)] px-1 py-0.5 text-xs ${
                      unsure
                        ? "border-amber-400/50 text-amber-200"
                        : "border-[var(--color-border)] text-slate-300"
                    }`}
                  >
                    {speakers.map((id) => (
                      <option key={id} value={id}>
                        {speakerLabel(id, job.speakerNames)}
                      </option>
                    ))}
                    {chunk.speaker != null && !speakers.includes(chunk.speaker) && (
                      <option value={chunk.speaker}>
                        {speakerLabel(chunk.speaker, job.speakerNames)}
                      </option>
                    )}
                    <option value="new">New speaker</option>
                    <option value="none">No speaker</option>
                  </select>
                )}

                <div className="min-w-0 flex-1">
                  {editing === index ? (
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                      rows={Math.max(1, Math.ceil(draft.length / 60))}
                      className="w-full resize-none rounded border border-sky-400/50 bg-[var(--color-surface-2)] px-1.5 py-0.5 text-sm leading-relaxed text-slate-100 outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(index)}
                      title="Click to edit"
                      className="w-full rounded px-1.5 py-0.5 text-left text-sm leading-relaxed text-slate-200 hover:bg-white/5"
                    >
                      {chunk.text.trim() || (
                        <span className="italic text-slate-500">(removed)</span>
                      )}
                    </button>
                  )}
                </div>

                {chunk.edited && (
                  <button
                    type="button"
                    title="Undo my changes to this line"
                    onClick={() => onRevert(job, index)}
                    className="mt-0.5 shrink-0 rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
