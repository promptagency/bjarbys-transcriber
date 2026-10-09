import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileAudio,
  HardDrive,
  Mic,
  Podcast,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Job, JobSource } from "../lib/jobs";
import type { TranscriptChunk } from "../lib/protocol";
import { TranscriptReview } from "./TranscriptReview";
import { speakersIn, toTxt } from "../lib/exporters";
import { Badge, ProgressBar, Spinner } from "./ui";
import { formatMessage, useT } from "../lib/i18n";

const SOURCE_ICON: Record<JobSource, typeof FileAudio> = {
  file: FileAudio,
  mic: Mic,
  podcast: Podcast,
};

function StatusCell({ job }: { job: Job }) {
  const t = useT();
  const s = t.queue.status;
  const pct = Math.round(job.stageProgress * 100);
  switch (job.status) {
    case "queued":
      return <Badge tone="neutral">{s.queued}</Badge>;
    case "fetching":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-neutral-400">
            {s.downloading(pct)}
          </span>
        </div>
      );
    case "decoding":
      return (
        <Badge tone="brand">
          <Spinner className="size-3" /> {s.decoding}
        </Badge>
      );
    case "transcribing":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-neutral-400">
            {s.transcribing(pct)}
          </span>
        </div>
      );
    case "diarizing":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-neutral-400">
            {s.diarizing(pct)}
          </span>
        </div>
      );
    case "done":
      return job.warning ? (
        <Badge tone="amber">
          <TriangleAlert className="size-3" /> {s.done}
        </Badge>
      ) : (
        <Badge tone="green">
          <Check className="size-3" /> {s.done}
        </Badge>
      );
    case "error":
      return (
        <Badge tone="red">
          <TriangleAlert className="size-3" /> {s.failed}
        </Badge>
      );
  }
}

/**
 * The transcript as it is being written. Follows the newest text, unless the
 * reader has scrolled up to read something earlier.
 */
function LivePreview({ text }: { text: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <div className="border-t border-[var(--color-border)] px-3 pb-3 pt-2">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
        {t.queue.livePreview}
      </p>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-neutral-300 scroll-thin"
      >
        {text}
      </div>
    </div>
  );
}

export function JobQueue({
  jobs,
  onDownload,
  onRemove,
  onClearCompleted,
  onRenameSpeaker,
  onEditChunk,
  onRevertChunk,
  onReplaceChunks,
  glossary,
  onOpenGlossary,
  onAddGlossaryTerms,
  keepTranscripts,
  askKeepTranscripts,
  onChooseKeepTranscripts,
}: {
  jobs: Job[];
  onDownload: (job: Job) => void;
  onRemove: (job: Job) => void;
  onClearCompleted: () => void;
  onRenameSpeaker: (job: Job, speaker: number, name: string) => void;
  onEditChunk: (job: Job, index: number, patch: Partial<TranscriptChunk>) => void;
  onRevertChunk: (job: Job, index: number) => void;
  onReplaceChunks: (job: Job, changes: Map<number, TranscriptChunk>) => void;
  /** The terms in the word list, for suggestions in the review view. */
  glossary: string[];
  onOpenGlossary: () => void;
  /** Adds names the user corrected to the word list. */
  onAddGlossaryTerms: (terms: string[]) => void;
  /** The user opted in to keeping finished transcripts across reloads. */
  keepTranscripts: boolean;
  /** Show the one-time question about keeping transcripts. */
  askKeepTranscripts: boolean;
  onChooseKeepTranscripts: (keep: boolean) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  if (jobs.length === 0) return null;

  const doneCount = jobs.filter((j) => j.status === "done").length;
  const restoredCount = jobs.filter((j) => j.restored).length;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function copy(job: Job) {
    if (!job.result) return;
    await navigator.clipboard.writeText(
      toTxt(job.result, job.speakerNames, t.export).trim(),
    );
    setCopied(job.id);
    window.setTimeout(() => setCopied((c) => (c === job.id ? null : c)), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {t.queue.title(jobs.length)}
        </h2>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={onClearCompleted}
            title={t.queue.deleteFinishedTitle}
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-red-300"
          >
            <Trash2 className="size-3.5" /> {t.queue.deleteFinished}
          </button>
        )}
      </div>

      {/*
        Transcripts outlive the tab, so say so plainly: nothing removes them
        automatically, and anyone using this browser profile can open them.
      */}
      {/*
        Keeping is opt-in, so the first finished transcript asks — with what
        the choice means — instead of quietly storing anything.
      */}
      {doneCount > 0 && askKeepTranscripts && (
        <div className="rounded-xl border border-brand-400/30 bg-brand-400/[0.07] p-3.5 text-xs leading-relaxed text-brand-100/90">
          <p className="mb-1 text-sm font-semibold text-brand-100">{t.queue.askTitle}</p>
          <p>
            {t.queue.askBefore}
            <strong className="font-semibold text-brand-100">{t.queue.askStay}</strong>
            {t.queue.askAfter}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onChooseKeepTranscripts(true)}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
            >
              {t.queue.yesKeep}
            </button>
            <button
              type="button"
              onClick={() => onChooseKeepTranscripts(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-300 ring-1 ring-inset ring-[var(--color-border)] hover:bg-white/5"
            >
              {t.queue.noThanks}
            </button>
          </div>
        </div>
      )}

      {doneCount > 0 && keepTranscripts && (
        <div className="flex gap-2.5 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] p-3 text-xs leading-relaxed text-brand-100/90">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-brand-300" />
          <p>
            {restoredCount > 0 && (
              <>
                <strong className="font-semibold text-brand-100">
                  {t.queue.restored(restoredCount)}
                </strong>{" "}
              </>
            )}
            {t.queue.keptBefore}
            <strong className="font-semibold text-brand-100">{t.queue.keptStay}</strong>
            {t.queue.keptAfter}
            <em>{t.queue.keptDeleteAll}</em>
            {t.queue.keptEnd}
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {jobs.map((job) => {
          const Icon = SOURCE_ICON[job.source];
          const open = expanded.has(job.id);
          return (
            <li
              key={job.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60"
            >
              <div className="flex items-center gap-3 p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-neutral-300">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-100">
                    {job.label}
                  </p>
                  {job.status === "error" && job.error && (
                    <p className="truncate text-xs text-red-300">
                      {formatMessage(t, job.error)}
                    </p>
                  )}
                  {job.status === "done" && job.result && (
                    <p className="truncate text-xs text-neutral-500">
                      {job.result.text.trim().slice(0, 80) || t.queue.noSpeech}
                    </p>
                  )}
                  {job.warning && (
                    <p className="truncate text-xs text-amber-300">
                      {formatMessage(t, job.warning)}
                    </p>
                  )}
                </div>

                <StatusCell job={job} />

                <div className="flex shrink-0 items-center gap-1">
                  {job.status === "done" && (
                    <>
                      <button
                        type="button"
                        title={t.queue.show}
                        onClick={() => toggle(job.id)}
                        className="rounded-lg p-2 text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                      >
                        <ChevronDown
                          className={`size-4 transition ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                      <button
                        type="button"
                        title={t.queue.download}
                        onClick={() => onDownload(job)}
                        className="rounded-lg p-2 text-brand-300 hover:bg-brand-400/10"
                      >
                        <Download className="size-4" />
                      </button>
                    </>
                  )}
                  {(job.status === "done" ||
                    job.status === "error" ||
                    job.status === "queued") && (
                    <button
                      type="button"
                      title={t.queue.remove}
                      onClick={() => onRemove(job)}
                      className="rounded-lg p-2 text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {(job.status === "transcribing" || job.status === "diarizing") &&
                job.liveText && <LivePreview text={job.liveText} />}

              {open && job.result && (
                <div className="border-t border-[var(--color-border)] p-3">
                  <SpeakerNamer job={job} onRename={onRenameSpeaker} />
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => copy(job)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-300 hover:bg-white/5"
                    >
                      {copied === job.id ? (
                        <>
                          <Check className="size-3.5" /> {t.queue.copied}
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> {t.queue.copy}
                        </>
                      )}
                    </button>
                  </div>
                  <TranscriptReview
                    job={job}
                    onEdit={onEditChunk}
                    onRevert={onRevertChunk}
                    onReplace={onReplaceChunks}
                    glossary={glossary}
                    onOpenGlossary={onOpenGlossary}
                    onAddGlossaryTerms={onAddGlossaryTerms}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One text field per detected speaker. Names apply straight away to the
 * transcript shown here, Copy, and every download format.
 */
function SpeakerNamer({
  job,
  onRename,
}: {
  job: Job;
  onRename: (job: Job, speaker: number, name: string) => void;
}) {
  const t = useT();
  const speakers = job.result ? speakersIn(job.result) : [];
  if (speakers.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {t.queue.nameSpeakers}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {speakers.map((speaker) => (
          <label key={speaker} className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">{t.export.speaker(speaker)}</span>
            <input
              type="text"
              value={job.speakerNames[speaker] ?? ""}
              placeholder={t.export.speaker(speaker)}
              onChange={(e) => onRename(job, speaker, e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-neutral-100 outline-none transition focus:border-brand-400/60 focus:ring-2 focus:ring-brand-400/20"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">{t.queue.namesHint}</p>
    </div>
  );
}
