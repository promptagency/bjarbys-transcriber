import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Cpu,
  Download,
  FileAudio,
  Mic,
  Podcast,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { WHISPER_SAMPLE_RATE, decodeToPCM } from "./lib/audio";
import {
  MAX_DIARIZE_MINUTES,
  MAX_DIARIZE_SECONDS,
  assignSpeakers,
  smoothSpeakers,
} from "./lib/diarize";
import {
  type Backend,
  type Family,
  FAMILY_DEFAULT_MODEL,
  FAMILY_META,
  availableTiers,
  defaultDtype,
  familyOf,
  findModel,
  formatSize,
  isEnglishOnly,
  tierFor,
} from "./lib/models";
import { type Settings, restoreSettings } from "./lib/settings";
import {
  deleteAllTranscripts,
  deleteTranscript,
  loadSettingsRaw,
  loadTranscripts,
  onSettingsChangedElsewhere,
  saveSettings,
  saveTranscript,
  toSaved,
} from "./lib/storage";
import {
  ACTIVE_STATUSES,
  type Job,
  type JobInput,
  jobFromSaved,
  makeJob,
} from "./lib/jobs";
import {
  type ExportFormat,
  extFor,
  render,
  withExtension,
  safeFileName,
  downloadText,
  downloadBlob,
} from "./lib/exporters";
import {
  DEFAULT_PROXY,
  type Episode,
  type Podcast as PodcastShow,
  fetchEpisodeAudio,
} from "./lib/podcasts";
import { createZip } from "./lib/zip";
import type { TranscriptChunk, TranscriptResult } from "./lib/protocol";
import { useWhisper } from "./hooks/useWhisper";
import { LanguageChooser } from "./components/LanguageChooser";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { Dropzone } from "./components/Dropzone";
import { Recorder } from "./components/Recorder";
import { PodcastPanel } from "./components/PodcastPanel";
import { JobQueue } from "./components/JobQueue";
import { ProcessingHero } from "./components/Processing";
import { Card } from "./components/ui";

type Tab = "files" | "mic" | "podcast";

const TABS: { id: Tab; label: string; icon: typeof FileAudio }[] = [
  { id: "files", label: "Files", icon: FileAudio },
  { id: "mic", label: "Record", icon: Mic },
  { id: "podcast", label: "Podcast", icon: Podcast },
];

export default function App() {
  const { state, loadModel, transcribe, diarize } = useWhisper();

  // Restored from the last visit; anything invalid falls back to defaults.
  const [settings, setSettings] = useState<Settings>(() =>
    restoreSettings(loadSettingsRaw()),
  );
  // Follow changes made in another tab, so this one never writes stale
  // settings back. Settings adopted that way are NOT saved again: if the
  // other tab made two quick changes, re-saving the first after the second
  // had landed would overwrite it — and the other tab would then adopt the
  // stale value (found in testing: switching keeping on was reverted).
  const adoptedFromElsewhere = useRef<string | null>(null);
  useEffect(() => {
    const json = JSON.stringify(settings);
    if (json === adoptedFromElsewhere.current) {
      adoptedFromElsewhere.current = null;
      return;
    }
    saveSettings(settings);
  }, [settings]);
  useEffect(
    () =>
      onSettingsChangedElsewhere(() => {
        const next = restoreSettings(loadSettingsRaw());
        adoptedFromElsewhere.current = JSON.stringify(next);
        setSettings(next);
      }),
    [],
  );
  const proxyBase = DEFAULT_PROXY;

  const [tab, setTab] = useState<Tab>("files");
  const [showSettings, setShowSettings] = useState(false);
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  const drainingRef = useRef(false);

  // ── WebGPU detection ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gpu = (
          navigator as unknown as {
            gpu?: { requestAdapter: () => Promise<unknown> };
          }
        ).gpu;
        const ok = !!gpu && !!(await gpu.requestAdapter());
        if (!cancelled) setWebgpuAvailable(ok);
      } catch {
        if (!cancelled) setWebgpuAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedDevice: Backend = useMemo(
    () =>
      settings.deviceMode === "auto"
        ? webgpuAvailable
          ? "webgpu"
          : "wasm"
        : settings.deviceMode,
    [settings.deviceMode, webgpuAvailable],
  );

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );

  // Keep the quantization valid for the chosen model + backend.
  useEffect(() => {
    const model = findModel(settings.modelId)!;
    const tiers = availableTiers(model, resolvedDevice);
    if (!tiers.some((t) => t.dtype === settings.dtype)) {
      patchSettings({ dtype: defaultDtype(model, resolvedDevice) });
    }
  }, [settings.modelId, settings.dtype, resolvedDevice, patchSettings]);

  const family = familyOf(settings.modelId);
  const setFamily = useCallback(
    (f: Family) => {
      patchSettings({
        modelId: FAMILY_DEFAULT_MODEL[f],
        language: f === "swedish" ? "sv" : null,
      });
    },
    [patchSettings],
  );

  const model = findModel(settings.modelId)!;
  const currentTier =
    tierFor(model, settings.dtype) ??
    availableTiers(model, resolvedDevice)[0] ??
    model.tiers[0];
  // Track the exact (model, dtype, device) we last asked the worker to load, so
  // changing quality or backend in Settings correctly triggers a reload. We
  // compare against the *requested* key (not the post-fallback actual device),
  // which avoids a reload loop when WebGPU silently falls back to WASM.
  const loadedReqKey = useRef("");
  const desiredKey = `${settings.modelId}|${settings.dtype}|${resolvedDevice}`;
  const loadedForModel =
    state.status === "ready" && loadedReqKey.current === desiredKey;

  // ── Job list helpers ──────────────────────────────────────────────────────
  const commit = useCallback((next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);
  const updateJob = useCallback(
    (id: string, patch: Partial<Job>) =>
      commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    [commit],
  );
  const addJobs = useCallback(
    (inputs: JobInput[]) => commit([...jobsRef.current, ...inputs.map(makeJob)]),
    [commit],
  );

  // ── Persistence ───────────────────────────────────────────────────────────
  // Only if the user opts in (`settings.keepTranscripts`), finished
  // transcripts survive a reload (see src/lib/storage.ts). `saved`
  // remembers the exact job object last written for each id, so only changed
  // jobs are written; ids that vanish from the list (✕, Delete all finished) are
  // deleted. Writes wait for a pause so typing a name doesn't write per key.
  // `job` is null when the last write failed, so the next pass retries it.
  const saved = useRef(new Map<string, { job: Job | null; savedAt: number }>());
  const [restoredOnce, setRestoredOnce] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // The choice as it stood when the page loaded decides whether to restore.
  const keepAtLoad = useRef(settings.keepTranscripts);
  useEffect(() => {
    let cancelled = false;
    if (!keepAtLoad.current) {
      // Not opted in: make sure nothing lingers from an earlier choice.
      void deleteAllTranscripts();
      setRestoredOnce(true);
      return;
    }
    loadTranscripts().then((records) => {
      if (cancelled) return;
      const restored = records.map(jobFromSaved);
      for (let i = 0; i < restored.length; i++) {
        saved.current.set(restored[i].id, {
          job: restored[i],
          savedAt: records[i].savedAt,
        });
      }
      // Restored transcripts go first: they're older than anything added
      // while storage was still loading.
      if (restored.length) commit([...restored, ...jobsRef.current]);
      setRestoredOnce(true);
    });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  const persist = useCallback(() => {
    // Before the restore finishes, an empty list would look like "everything
    // was removed".
    if (!restoredOnce || !settings.keepTranscripts) return;
    const done = new Map(
      jobsRef.current
        .filter((j) => j.status === "done" && j.result)
        .map((j) => [j.id, j]),
    );
    for (const [id, job] of done) {
      const prev = saved.current.get(id);
      if (prev?.job === job) continue;
      const savedAt = prev?.savedAt ?? Date.now();
      saved.current.set(id, { job, savedAt });
      void saveTranscript(toSaved(job, savedAt)!).then((ok) => {
        if (ok) return;
        setSaveFailed(true);
        // Not saved after all: forget it (unless a newer version has been
        // queued since), so the next pass tries again.
        const entry = saved.current.get(id);
        if (entry?.job === job) entry.job = null;
      });
    }
    for (const id of [...saved.current.keys()]) {
      if (done.has(id)) continue;
      saved.current.delete(id);
      void deleteTranscript(id);
    }
  }, [restoredOnce, settings.keepTranscripts]);
  // Timers and the toggle effect call whatever `persist` is current when they
  // run, not the one captured when they were scheduled.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Turning keeping off deletes every saved copy (the list on screen stays
  // until reload); turning it on saves what's already finished right away.
  useEffect(() => {
    if (!restoredOnce) return;
    if (settings.keepTranscripts) {
      persistRef.current();
    } else {
      saved.current.clear();
      setSaveFailed(false);
      void deleteAllTranscripts();
    }
  }, [settings.keepTranscripts, restoredOnce]);

  // At most one save pass per 400 ms. Deliberately NOT a debounce: while a
  // queue runs, progress updates change `jobs` many times a second, and a
  // timer restarted on every change would postpone saving finished
  // transcripts for as long as the queue keeps running.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current !== null) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      persistRef.current();
    }, 400);
  }, [jobs, persist]);
  useEffect(
    () => () => {
      // Reset, not just clear: React's StrictMode remounts in development,
      // and a stale id here would block every future save.
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    },
    [],
  );

  // Don't let the pause before saving lose the last edit: a hidden tab
  // throttles timers to about once a minute, and a closed tab never fires
  // them. Save immediately when the page is hidden or unloaded.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", persist);
    };
  }, [persist]);

  // Every format is rendered from the already-transcribed result, so saving
  // several costs no extra analysis.
  //
  // Several formats are bundled into one archive rather than written as
  // separate downloads: browsers block a burst of downloads as "multiple
  // automatic downloads" and keep only the first, without surfacing an error
  // the page can catch (verified in Chrome). One file can't half-succeed.
  const downloadJob = useCallback(
    (job: Job, result: TranscriptResult, formats: ExportFormat[]) => {
      if (formats.length === 0) return;
      // Podcast names are built from episode titles, which routinely contain
      // slashes ("3/12 recap"). A browser strips those from a download name,
      // but inside a ZIP a slash is a path separator and would nest the files.
      const base = safeFileName(job.downloadName);
      if (formats.length === 1) {
        const format = formats[0];
        downloadText(
          withExtension(base, extFor(format)),
          render(result, format, job.speakerNames),
          format,
        );
        return;
      }
      const zip = createZip(
        formats.map((format) => ({
          name: withExtension(base, extFor(format)),
          text: render(result, format, job.speakerNames),
        })),
      );
      downloadBlob(withExtension(base, "zip"), zip);
    },
    [],
  );

  // ── Sequential queue runner ───────────────────────────────────────────────
  const runJob = useCallback(
    async (job: Job) => {
      try {
        updateJob(job.id, {
          status: job.source === "podcast" ? "fetching" : "decoding",
          error: null,
          warning: null,
          willDiarize: settings.diarizeSpeakers,
          stageProgress: 0,
        });
        const media = await job.getMedia((p) =>
          updateJob(job.id, { stageProgress: p }),
        );
        updateJob(job.id, { media, status: "decoding", stageProgress: 0 });
        const audio = await decodeToPCM(media);

        updateJob(job.id, { status: "transcribing", stageProgress: 0 });
        const loadedId = state.modelId ?? settings.modelId;
        const englishOnly = isEnglishOnly(loadedId);
        // The diarization model has no internal chunking (unlike Whisper) and
        // crashes on very long audio in-browser — skip it above a safe length
        // rather than attempt and silently fail.
        const durationSec = audio.length / WHISPER_SAMPLE_RATE;
        const tooLongToDiarize = durationSec > MAX_DIARIZE_SECONDS;
        const wantsDiarize = settings.diarizeSpeakers && !tooLongToDiarize;
        if (!wantsDiarize) updateJob(job.id, { willDiarize: false });
        // The worker holds on to the audio when it will be needed again, so
        // diarization reuses that buffer instead of a second full copy.
        const result = await transcribe(
          job.id,
          audio,
          {
            language: englishOnly ? null : settings.language,
            task: englishOnly ? "transcribe" : settings.task,
            retainAudio: wantsDiarize,
          },
          (p) => updateJob(job.id, { stageProgress: p }),
        );

        let finalResult = result;
        let warning: string | null = null;
        if (settings.diarizeSpeakers && tooLongToDiarize) {
          warning = `Speaker separation skipped: recording is ${Math.round(durationSec / 60)} min, longer than the ${MAX_DIARIZE_MINUTES} min limit.`;
        } else if (wantsDiarize) {
          // No multi-pass warning: labels used to restart at every window, so
          // warning was always right. They're now matched across the overlap,
          // so it would be wrong far more often than right — and an amber badge
          // on every long file would devalue the one that flags real failures.
          updateJob(job.id, { status: "diarizing", stageProgress: 0, warning });
          try {
            const activity = await diarize(job.id, (p) =>
              updateJob(job.id, { stageProgress: p }),
            );
            finalResult = {
              ...result,
              chunks: smoothSpeakers(assignSpeakers(result.chunks, activity)),
            };
          } catch (e) {
            warning = `Speaker separation failed: ${String((e as Error)?.message ?? e)}`;
          }
        }

        updateJob(job.id, {
          status: "done",
          result: finalResult,
          originalResult: finalResult,
          warning,
        });
        if (settings.autoDownload)
          downloadJob(job, finalResult, settings.exportFormats);
      } catch (e) {
        updateJob(job.id, {
          status: "error",
          error: String((e as Error)?.message ?? e),
        });
      }
    },
    [
      updateJob,
      transcribe,
      diarize,
      downloadJob,
      state.modelId,
      settings.modelId,
      settings.language,
      settings.task,
      settings.autoDownload,
      settings.exportFormats,
      settings.diarizeSpeakers,
    ],
  );

  const drain = useCallback(async () => {
    if (drainingRef.current || !loadedForModel) return;
    drainingRef.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((j) => j.status === "queued");
        if (!next) break;
        await runJob(next);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [loadedForModel, runJob]);

  useEffect(() => {
    void drain();
  }, [jobs, loadedForModel, drain]);

  // ── Model loading (manual + auto when work arrives) ───────────────────────
  const handleLoad = useCallback(() => {
    loadedReqKey.current = `${settings.modelId}|${settings.dtype}|${resolvedDevice}`;
    loadModel(settings.modelId, settings.dtype, resolvedDevice).catch(() => {});
  }, [loadModel, settings.modelId, settings.dtype, resolvedDevice]);

  useEffect(() => {
    const hasQueued = jobs.some((j) => j.status === "queued");
    if (!hasQueued) return;
    if (state.status === "loading" || state.status === "error") return;
    if (loadedForModel) return;
    handleLoad();
  }, [jobs, state.status, loadedForModel, handleLoad]);

  // ── Source → queue wiring ─────────────────────────────────────────────────
  const onFiles = useCallback(
    (files: File[]) =>
      addJobs(
        files.map((f) => ({
          label: f.name,
          source: "file" as const,
          downloadName: f.name,
          getMedia: async () => f,
        })),
      ),
    [addJobs],
  );

  const onRecorded = useCallback(
    (blob: Blob, label: string) =>
      addJobs([
        {
          label,
          source: "mic",
          downloadName: label,
          getMedia: async () => blob,
        },
      ]),
    [addJobs],
  );

  const onEnqueueEpisodes = useCallback(
    (show: PodcastShow, episodes: Episode[]) => {
      addJobs(
        episodes.map((ep) => ({
          label: ep.title,
          source: "podcast" as const,
          downloadName: `${show.title} - ${ep.title}`,
          getMedia: (onProgress) =>
            fetchEpisodeAudio(ep, proxyBase, (l, t) =>
              onProgress?.(t ? l / t : 0),
            ),
        })),
      );
      setTab("files");
    },
    [addJobs, proxyBase],
  );

  // ── Queue actions ─────────────────────────────────────────────────────────
  const onRemove = useCallback(
    (job: Job) => commit(jobsRef.current.filter((j) => j.id !== job.id)),
    [commit],
  );
  const onClearCompleted = useCallback(
    () => commit(jobsRef.current.filter((j) => j.status !== "done")),
    [commit],
  );
  const onRenameSpeaker = useCallback(
    (job: Job, speaker: number, name: string) => {
      const current = jobsRef.current.find((j) => j.id === job.id);
      if (!current) return;
      updateJob(job.id, {
        speakerNames: { ...current.speakerNames, [speaker]: name },
      });
    },
    [updateJob],
  );
  // Manual corrections from the review view. Whisper's flat `text` is rebuilt
  // from the chunks so exports without speakers (which use it) see the edit.
  const onEditChunk = useCallback(
    (job: Job, index: number, patch: Partial<TranscriptChunk>) => {
      const current = jobsRef.current.find((j) => j.id === job.id);
      if (!current?.result) return;
      const chunks = current.result.chunks.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...patch, edited: true };
        // A speaker chosen by hand is certain; the model's margin no longer
        // describes it. "No speaker" matches what assignSpeakers writes.
        if ("speaker" in patch) next.speaker_conf = patch.speaker == null ? 0 : 1;
        return next;
      });
      updateJob(job.id, {
        result: { text: chunks.map((c) => c.text).join(""), chunks },
      });
    },
    [updateJob],
  );
  const onRevertChunk = useCallback(
    (job: Job, index: number) => {
      const current = jobsRef.current.find((j) => j.id === job.id);
      const original = current?.originalResult?.chunks[index];
      if (!current?.result || !original) return;
      const chunks = current.result.chunks.map((c, i) => (i === index ? original : c));
      const edited = chunks.some((c) => c.edited);
      updateJob(job.id, {
        // With nothing left edited, restore Whisper's own text exactly.
        result: edited
          ? { text: chunks.map((c) => c.text).join(""), chunks }
          : current.originalResult,
      });
    },
    [updateJob],
  );
  const onManualDownload = useCallback(
    (job: Job) => {
      if (job.result) downloadJob(job, job.result, settings.exportFormats);
    },
    [downloadJob, settings.exportFormats],
  );

  const activeJob = jobs.find((j) => ACTIVE_STATUSES.includes(j.status)) ?? null;
  // Transcripts restored from an earlier visit aren't part of this run.
  const sessionJobs = jobs.filter((j) => !j.restored);
  const processed = sessionJobs.filter(
    (j) => j.status === "done" || j.status === "error",
  ).length;
  const busy = state.status === "loading" || !!activeJob;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {/* Header */}
      <header className="mb-8 text-center">
        <div className="mb-3 flex items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 text-white shadow-lg shadow-sky-500/20">
            <FileAudio className="size-7" />
          </div>
          <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
            Vem sa vad?
          </h1>
        </div>
        <p className="mx-auto max-w-md text-base text-slate-400">
          Turn talking into text — privately, right in your browser.{" "}
          <span className="whitespace-nowrap">Nothing is uploaded ✨</span>
        </p>
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
            <ShieldCheck className="size-4" />
            100% on your device
          </span>
        </div>
      </header>

      {/* Step 1 — language */}
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
        What language is it in?
      </p>
      <LanguageChooser
        value={family}
        onChange={setFamily}
        disabled={state.status === "loading"}
      />

      {/* Step 2 — source tabs */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                active
                  ? "bg-sky-500 text-white shadow-lg shadow-sky-500/20"
                  : "bg-[var(--color-surface)]/60 text-slate-300 ring-1 ring-inset ring-[var(--color-border)] hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Source area */}
      <div className="mt-3">
        {tab === "files" && <Dropzone onFiles={onFiles} />}
        {tab === "mic" && (
          <Card className="p-4">
            <Recorder onRecorded={onRecorded} />
          </Card>
        )}
        {tab === "podcast" && (
          <Card className="p-5">
            <PodcastPanel proxyBase={proxyBase} onEnqueue={onEnqueueEpisodes} />
          </Card>
        )}
      </div>

      {/* Model status + settings toggle */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-base">{FAMILY_META[family].emoji}</span>
          <span className="font-medium text-slate-200">{model.name}</span>
          <span className="text-slate-600">·</span>
          {state.status === "loading" ? (
            <span className="text-sky-300">
              loading {Math.round(state.overall * 100)}%
            </span>
          ) : loadedForModel ? (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              {state.device === "webgpu" ? (
                <Zap className="size-3.5" />
              ) : (
                <Cpu className="size-3.5" />
              )}
              ready
            </span>
          ) : (
            <span>{formatSize(currentTier.sizeMB)} · loads on first file</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
        >
          <Sliders className="size-4" />
          Settings
          <ChevronDown
            className={`size-4 transition ${showSettings ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Optional: pre-load button when idle */}
      {!loadedForModel && state.status !== "loading" && (
        <button
          type="button"
          onClick={handleLoad}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-2 text-sm text-slate-300 transition hover:border-sky-400/30 hover:text-white"
        >
          <Download className="size-4" />
          Pre-download {model.name} ({formatSize(currentTier.sizeMB)})
        </button>
      )}

      {/* Advanced settings drawer */}
      {showSettings && (
        <Card className="mt-3 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Sparkles className="size-4 text-sky-300" /> Fine-tune
          </div>
          <AdvancedSettings
            settings={settings}
            onChange={patchSettings}
            resolvedDevice={resolvedDevice}
            webgpuAvailable={webgpuAvailable}
            disabled={state.status === "loading"}
          />
          {state.status === "ready" && !loadedForModel && (
            <button
              type="button"
              onClick={handleLoad}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              <Download className="size-4" /> Apply &amp; reload model
            </button>
          )}
          {state.status === "error" && state.error && (
            <p className="mt-3 text-sm text-red-300">{state.error}</p>
          )}
        </Card>
      )}

      {/* Processing + queue */}
      {busy && (
        <div className="mt-5">
          <ProcessingHero
            state={state}
            activeJob={activeJob}
            done={processed}
            total={sessionJobs.length}
          />
        </div>
      )}

      {saveFailed && settings.keepTranscripts && (
        <p className="mt-5 text-xs text-amber-300">
          This browser refused to save a transcript (a private window, or storage
          is full or blocked), so it may be missing after a reload. Download
          anything you want to keep.
        </p>
      )}

      <div className="mt-5">
        <JobQueue
          jobs={jobs}
          onDownload={onManualDownload}
          onRenameSpeaker={onRenameSpeaker}
          onEditChunk={onEditChunk}
          onRevertChunk={onRevertChunk}
          onRemove={onRemove}
          onClearCompleted={onClearCompleted}
          keepTranscripts={settings.keepTranscripts}
          askKeepTranscripts={
            !settings.keepTranscripts && !settings.keepTranscriptsAsked
          }
          onChooseKeepTranscripts={(keep) =>
            patchSettings({ keepTranscripts: keep, keepTranscriptsAsked: true })
          }
        />
      </div>

      <footer className="mt-12 border-t border-[var(--color-border)] pt-6 text-center text-xs text-slate-500">
        <p>
          Vem sa vad? by{" "}
          <span className="font-medium text-slate-300">Micke Quick</span> ·{" "}
          <a
            href="https://github.com/promptagency/vem-sa-vad"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </p>
        <p className="mt-2">
          Based on{" "}
          <a
            href="https://github.com/fltman/bjarbys-transcriber"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Bjarbys Transcriber
          </a>{" "}
          by <span className="font-medium text-slate-300">Anders Bjarby</span>
        </p>
        <p className="mt-2">
          Powered by{" "}
          <a
            href="https://github.com/huggingface/transformers.js"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Transformers.js
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/KBLab"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            KB-Whisper
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/pyannote/segmentation-3.0"
            className="text-slate-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            pyannote
          </a>{" "}
          · models download once and cache in your browser.
        </p>
      </footer>
    </div>
  );
}
