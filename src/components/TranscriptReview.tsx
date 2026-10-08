import { useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw, Search, Square } from "lucide-react";
import type { Job } from "../lib/jobs";
import type { TranscriptChunk } from "../lib/protocol";
import { LOW_CONFIDENCE } from "../lib/diarize";
import { speakerLabel, speakersIn } from "../lib/exporters";
import { changingMatches, findPattern, matchRanges, replaceInChunks } from "../lib/replace";
import { type Strings, languageName, useT } from "../lib/i18n";

/** `text` with every match of `pattern` marked. React escapes the text itself. */
function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  const ranges = pattern ? matchRanges(text, pattern) : [];
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded bg-sky-400/30 px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The two chunks are the same apart from their text. */
function sameExceptText(a: TranscriptChunk, b: TranscriptChunk): boolean {
  return (
    a.speaker === b.speaker &&
    a.speaker_conf === b.speaker_conf &&
    !!a.edited === !!b.edited &&
    a.timestamp[0] === b.timestamp[0] &&
    a.timestamp[1] === b.timestamp[1]
  );
}

/** What the last "Replace all" changed, so it can be undone in one step. */
interface LastReplace {
  before: Map<number, TranscriptChunk>;
  after: Map<number, TranscriptChunk>;
  matches: number;
}

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
  onReplace,
}: {
  job: Job;
  onEdit: (job: Job, index: number, patch: Partial<TranscriptChunk>) => void;
  onRevert: (job: Job, index: number) => void;
  onReplace: (job: Job, changes: Map<number, TranscriptChunk>) => void;
}) {
  const t = useT();
  const r = t.review;
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

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [lastReplace, setLastReplace] = useState<LastReplace | null>(null);
  // A function of the strings, not finished text, so it follows a language switch.
  const [replaceNote, setReplaceNote] = useState<((t: Strings) => string) | null>(null);
  const pattern = useMemo(
    () => (findOpen ? findPattern(query, { matchCase, wholeWords }) : null),
    [findOpen, query, matchCase, wholeWords],
  );

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
  const matchesIn = (chunk: TranscriptChunk) =>
    pattern ? matchRanges(chunk.text, pattern).length : 0;
  const matchCount = pattern ? rows.reduce((n, { chunk }) => n + matchesIn(chunk), 0) : 0;
  const matchLines = pattern ? rows.filter(({ chunk }) => matchesIn(chunk) > 0).length : 0;
  // Matches already reading as the replacement ("Anna" when replacing "anna")
  // stay highlighted but there is nothing to change in them.
  const toChange = pattern
    ? rows.reduce((n, { chunk }) => n + changingMatches(chunk.text, pattern, replacement), 0)
    : 0;
  // Each filter applies only while its control is visible: if every speaker is
  // removed by hand the unsure checkbox disappears, and a filter left on would
  // hide all lines for good.
  const shown = rows.filter(
    ({ chunk }) =>
      (!(onlyUnsure && hasSpeakers) || isUnsure(chunk, hasSpeakers)) &&
      (!(onlyMatches && pattern) || matchesIn(chunk) > 0),
  );

  function replaceAll() {
    if (!pattern || editing !== null) return;
    const { changes, matches } = replaceInChunks(chunks, pattern, replacement);
    if (changes.size === 0) return;
    const before = new Map([...changes.keys()].map((i) => [i, chunks[i]]));
    onReplace(job, changes);
    setLastReplace({ before, after: changes, matches });
    setReplaceNote(() => (t: Strings) => t.review.replaced(matches, changes.size));
  }

  function undoReplace() {
    if (!lastReplace) return;
    // Lines edited again since the replacement keep those edits.
    const restore = new Map<number, TranscriptChunk>();
    let kept = 0;
    for (const [i, before] of lastReplace.before) {
      const after = lastReplace.after.get(i)!;
      const current = chunks[i];
      if (!current || current.text !== after.text) {
        kept++;
        continue;
      }
      restore.set(
        i,
        sameExceptText(current, after) ? before : { ...current, text: before.text, edited: true },
      );
    }
    onReplace(job, restore);
    setLastReplace(null);
    setReplaceNote(() => (t: Strings) => (kept ? t.review.undoneKept(kept) : t.review.undone));
  }

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {hasSpeakers && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={onlyUnsure}
                onChange={(e) => setOnlyUnsure(e.target.checked)}
                className="size-3.5 accent-amber-500"
              />
              {r.onlyUnsure(unsureCount)}
            </label>
          )}
          <button
            type="button"
            onClick={() => setFindOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-white/5 ${findOpen ? "text-sky-300" : ""}`}
          >
            <Search className="size-3.5" /> {r.findReplace}
          </button>
          {result.language && (
            <span title={r.detectedTitle}>
              {r.detected(languageName(result.language, t))}
            </span>
          )}
        </div>
        {job.restored ? (
          <span>{r.restored}</span>
        ) : playbackError || !job.media ? (
          <span className="text-amber-300">{r.noPlayback}</span>
        ) : (
          <span>{r.hint}</span>
        )}
      </div>

      {findOpen && (
        <div className="mb-2 rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-2 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setReplaceNote(null);
              }}
              placeholder={r.find}
              aria-label={r.find}
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-400/50"
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={r.replaceWith}
              aria-label={r.replaceWith}
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-400/50"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} className="size-3.5 accent-sky-500" />
              {r.matchCase}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} className="size-3.5 accent-sky-500" />
              {r.wholeWords}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} className="size-3.5 accent-sky-500" />
              {r.onlyMatches}
            </label>
            <span className="ml-auto">
              {pattern
                ? r.matches(matchCount, matchLines) +
                  (toChange < matchCount ? r.alreadyReplaced(matchCount - toChange) : "")
                : ""}
            </span>
            <button
              type="button"
              onClick={replaceAll}
              disabled={!pattern || toChange === 0 || editing !== null}
              title={editing !== null ? r.finishEditing : ""}
              className="rounded bg-sky-500 px-2.5 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
            >
              {r.replaceAll}
            </button>
            {lastReplace && (
              <button
                type="button"
                onClick={undoReplace}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-slate-200 hover:bg-white/5"
              >
                {r.undo}
              </button>
            )}
          </div>
          {replaceNote && <p className="mt-1.5 text-slate-300">{replaceNote(t)}</p>}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          {onlyMatches && pattern ? r.noMatches : onlyUnsure ? r.noUnsure : t.queue.noSpeech}
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
                  title={playing === index ? r.stop : r.play}
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
                    title={unsure ? r.unsureTitle : r.speaker}
                    className={`mt-0.5 w-28 shrink-0 truncate rounded border bg-[var(--color-surface-2)] px-1 py-0.5 text-xs ${
                      unsure
                        ? "border-amber-400/50 text-amber-200"
                        : "border-[var(--color-border)] text-slate-300"
                    }`}
                  >
                    {speakers.map((id) => (
                      <option key={id} value={id}>
                        {speakerLabel(id, job.speakerNames, t.export)}
                      </option>
                    ))}
                    {chunk.speaker != null && !speakers.includes(chunk.speaker) && (
                      <option value={chunk.speaker}>
                        {speakerLabel(chunk.speaker, job.speakerNames, t.export)}
                      </option>
                    )}
                    <option value="new">{r.newSpeaker}</option>
                    <option value="none">{r.noSpeaker}</option>
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
                      title={r.clickToEdit}
                      className="w-full rounded px-1.5 py-0.5 text-left text-sm leading-relaxed text-slate-200 hover:bg-white/5"
                    >
                      {chunk.text.trim() ? (
                        <Highlighted text={chunk.text.trim()} pattern={pattern} />
                      ) : (
                        <span className="italic text-slate-500">{r.removed}</span>
                      )}
                    </button>
                  )}
                </div>

                {chunk.edited && (
                  <button
                    type="button"
                    title={r.revert}
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
