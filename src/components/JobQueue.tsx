import { useState } from "react";
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

const SOURCE_ICON: Record<JobSource, typeof FileAudio> = {
  file: FileAudio,
  mic: Mic,
  podcast: Podcast,
};

function StatusCell({ job }: { job: Job }) {
  switch (job.status) {
    case "queued":
      return <Badge tone="neutral">Queued</Badge>;
    case "fetching":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-slate-400">
            Downloading… {Math.round(job.stageProgress * 100)}%
          </span>
        </div>
      );
    case "decoding":
      return (
        <Badge tone="brand">
          <Spinner className="size-3" /> Decoding
        </Badge>
      );
    case "transcribing":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-slate-400">
            Transcribing… {Math.round(job.stageProgress * 100)}%
          </span>
        </div>
      );
    case "diarizing":
      return (
        <div className="w-40">
          <ProgressBar value={job.stageProgress} />
          <span className="mt-1 block text-xs text-slate-400">
            Separating speakers… {Math.round(job.stageProgress * 100)}%
          </span>
        </div>
      );
    case "done":
      return job.warning ? (
        <Badge tone="amber">
          <TriangleAlert className="size-3" /> Done
        </Badge>
      ) : (
        <Badge tone="green">
          <Check className="size-3" /> Done
        </Badge>
      );
    case "error":
      return (
        <Badge tone="red">
          <TriangleAlert className="size-3" /> Failed
        </Badge>
      );
  }
}

export function JobQueue({
  jobs,
  onDownload,
  onRemove,
  onClearCompleted,
  onRenameSpeaker,
  onEditChunk,
  onRevertChunk,
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
  /** The user opted in to keeping finished transcripts across reloads. */
  keepTranscripts: boolean;
  /** Show the one-time question about keeping transcripts. */
  askKeepTranscripts: boolean;
  onChooseKeepTranscripts: (keep: boolean) => void;
}) {
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
      toTxt(job.result, job.speakerNames).trim(),
    );
    setCopied(job.id);
    window.setTimeout(() => setCopied((c) => (c === job.id ? null : c)), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Queue · {jobs.length}
        </h2>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={onClearCompleted}
            title="Deletes all finished transcripts from this list and from this browser"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-300"
          >
            <Trash2 className="size-3.5" /> Delete all finished
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
        <div className="rounded-xl border border-sky-400/30 bg-sky-400/[0.07] p-3.5 text-xs leading-relaxed text-sky-100/90">
          <p className="mb-1 text-sm font-semibold text-sky-100">
            Keep finished transcripts if you reload the page?
          </p>
          <p>
            If you say yes, they&rsquo;re saved in this browser (never uploaded)
            and <strong className="font-semibold text-sky-100">stay until you
            delete them</strong> — anyone using this browser could open them. If
            you say no, they disappear when you close or reload the page, so
            download what you need. You can change this later in Settings.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onChooseKeepTranscripts(true)}
              className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600"
            >
              Yes, keep them
            </button>
            <button
              type="button"
              onClick={() => onChooseKeepTranscripts(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 ring-1 ring-inset ring-[var(--color-border)] hover:bg-white/5"
            >
              No thanks
            </button>
          </div>
        </div>
      )}

      {doneCount > 0 && keepTranscripts && (
        <div className="flex gap-2.5 rounded-xl border border-sky-400/25 bg-sky-400/[0.06] p-3 text-xs leading-relaxed text-sky-100/90">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-sky-300" />
          <p>
            {restoredCount > 0 && (
              <>
                <strong className="font-semibold text-sky-100">
                  Restored {restoredCount} transcript{restoredCount === 1 ? "" : "s"} from
                  your last visit.
                </strong>{" "}
              </>
            )}
            Finished transcripts are <strong className="font-semibold text-sky-100">saved
            in this browser and stay until you delete them</strong> — with ✕ on each one,
            or <em>Delete all finished</em>. On a shared computer, delete them when
            you&rsquo;re done.
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
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-300">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {job.label}
                  </p>
                  {job.status === "error" && job.error && (
                    <p className="truncate text-xs text-red-300">{job.error}</p>
                  )}
                  {job.status === "done" && job.result && (
                    <p className="truncate text-xs text-slate-500">
                      {job.result.text.trim().slice(0, 80) || "(no speech detected)"}
                    </p>
                  )}
                  {job.warning && (
                    <p className="truncate text-xs text-amber-300">
                      {job.warning}
                    </p>
                  )}
                </div>

                <StatusCell job={job} />

                <div className="flex shrink-0 items-center gap-1">
                  {job.status === "done" && (
                    <>
                      <button
                        type="button"
                        title="Show transcript"
                        onClick={() => toggle(job.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      >
                        <ChevronDown
                          className={`size-4 transition ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                      <button
                        type="button"
                        title="Download transcript"
                        onClick={() => onDownload(job)}
                        className="rounded-lg p-2 text-sky-300 hover:bg-sky-400/10"
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
                      title="Remove"
                      onClick={() => onRemove(job)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {open && job.result && (
                <div className="border-t border-[var(--color-border)] p-3">
                  <SpeakerNamer job={job} onRename={onRenameSpeaker} />
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => copy(job)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
                    >
                      {copied === job.id ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <TranscriptReview
                    job={job}
                    onEdit={onEditChunk}
                    onRevert={onRevertChunk}
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
  const speakers = job.result ? speakersIn(job.result) : [];
  if (speakers.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Name the speakers
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {speakers.map((speaker) => (
          <label key={speaker} className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Speaker {speaker}</span>
            <input
              type="text"
              value={job.speakerNames[speaker] ?? ""}
              placeholder={`Speaker ${speaker}`}
              onChange={(e) => onRename(job, speaker, e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Names are used in the transcript, Copy and downloads. A file that was
        downloaded automatically still says &ldquo;Speaker 1&rdquo; — download
        it again after naming.
      </p>
    </div>
  );
}
