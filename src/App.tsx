import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  I18nContext,
  type Message,
  STRINGS,
  messageOf,
  modelName,
} from "./lib/i18n";
import {
  ChevronDown,
  Download,
  FileAudio,
  Mic,
  Podcast,
  ShieldCheck,
  Sliders,
  Sparkles,
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
  availableTiers,
  defaultDtype,
  findModel,
  formatSize,
  isEnglishOnly,
  tierFor,
  tierSizeMB,
} from "./lib/models";
import {
  type Settings,
  forSpokenLanguage,
  restoreSettings,
  spokenLanguage,
} from "./lib/settings";
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
import { RecordingLanguage } from "./components/RecordingLanguage";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { Logo } from "./components/Logo";
import { Faq } from "./components/Faq";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { Dropzone } from "./components/Dropzone";
import { Recorder } from "./components/Recorder";
import { PodcastPanel } from "./components/PodcastPanel";
import { JobQueue } from "./components/JobQueue";
import { ProcessingHero } from "./components/Processing";
import { Card } from "./components/ui";

type Tab = "files" | "mic" | "podcast";

const TABS: { id: Tab; icon: typeof FileAudio }[] = [
  { id: "files", icon: FileAudio },
  { id: "mic", icon: Mic },
  { id: "podcast", icon: Podcast },
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

  // Interface language. The page's own language, title and description follow
  // it, so screen readers, translation prompts and the tab title agree.
  const t = STRINGS[settings.uiLanguage];
  useEffect(() => {
    document.documentElement.lang = settings.uiLanguage;
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", t.meta.description);
  }, [settings.uiLanguage, t]);

  const [activeTab, setTab] = useState<Tab>("files");
  const [showSettings, setShowSettings] = useState(false);
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);
  const [gpuF16, setGpuF16] = useState(true);

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
            gpu?: {
              requestAdapter: () => Promise<{ features: Set<string> } | null>;
            };
          }
        ).gpu;
        const adapter = gpu ? await gpu.requestAdapter() : null;
        if (!cancelled) {
          setWebgpuAvailable(!!adapter);
          setGpuF16(!!adapter?.features.has("shader-f16"));
        }
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

  const setSpokenLanguage = useCallback(
    (code: string | null) => setSettings((s) => ({ ...s, ...forSpokenLanguage(s, code) })),
    [],
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
    (
      job: Job,
      result: TranscriptResult,
      formats: ExportFormat[],
      documentTimestamps: boolean,
    ) => {
      if (formats.length === 0) return;
      // A file's label is its filename; the document heading reads better without ".wav".
      const title = job.source === "file" ? job.label.replace(/\.[^.\s]{1,5}$/, "") : job.label;
      const document = { title, timestamps: documentTimestamps };
      // Podcast names are built from episode titles, which routinely contain
      // slashes ("3/12 recap"). A browser strips those from a download name,
      // but inside a ZIP a slash is a path separator and would nest the files.
      const base = safeFileName(job.downloadName);
      if (formats.length === 1) {
        const format = formats[0];
        downloadText(
          withExtension(base, extFor(format)),
          render(result, format, job.speakerNames, document, t.export),
          format,
        );
        return;
      }
      const zip = createZip(
        formats.map((format) => ({
          name: withExtension(base, extFor(format)),
          text: render(result, format, job.speakerNames, document, t.export),
        })),
      );
      downloadBlob(withExtension(base, "zip"), zip);
    },
    [t],
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
          (text) => updateJob(job.id, { liveText: text }),
        );
        // The merged transcript replaces the approximate preview while
        // speakers are separated.
        updateJob(job.id, { liveText: result.text.trim() });

        let finalResult = result;
        let warning: Message | null = null;
        if (settings.diarizeSpeakers && tooLongToDiarize) {
          warning = {
            key: "diarizeTooLong",
            params: { minutes: Math.round(durationSec / 60), limit: MAX_DIARIZE_MINUTES },
          };
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
            warning = { key: "diarizeFailed", params: { detail: String((e as Error)?.message ?? e) } };
          }
        }

        updateJob(job.id, {
          status: "done",
          result: finalResult,
          originalResult: finalResult,
          warning,
          liveText: undefined,
        });
        if (settings.autoDownload)
          downloadJob(
            job,
            finalResult,
            settings.exportFormats,
            settings.documentTimestamps,
          );
      } catch (e) {
        updateJob(job.id, {
          status: "error",
          error: messageOf(e),
          liveText: undefined,
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
      settings.documentTimestamps,
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
        result: { ...current.result, text: chunks.map((c) => c.text).join(""), chunks },
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
          ? { ...current.result, text: chunks.map((c) => c.text).join(""), chunks }
          : current.originalResult,
      });
    },
    [updateJob],
  );
  // Find & replace (and its undo): several lines in one update, so the
  // transcript re-renders and is saved once rather than once per line.
  const onReplaceChunks = useCallback(
    (job: Job, changes: Map<number, TranscriptChunk>) => {
      const current = jobsRef.current.find((j) => j.id === job.id);
      if (!current?.result || changes.size === 0) return;
      const chunks = current.result.chunks.map((c, i) => changes.get(i) ?? c);
      const edited = chunks.some((c) => c.edited);
      updateJob(job.id, {
        // With nothing left edited (an undo), restore Whisper's own text exactly.
        result:
          edited || !current.originalResult
            ? { ...current.result, text: chunks.map((c) => c.text).join(""), chunks }
            : current.originalResult,
      });
    },
    [updateJob],
  );
  const onManualDownload = useCallback(
    (job: Job) => {
      if (job.result) {
        downloadJob(
          job,
          job.result,
          settings.exportFormats,
          settings.documentTimestamps,
        );
      }
    },
    [downloadJob, settings.exportFormats, settings.documentTimestamps],
  );

  const activeJob = jobs.find((j) => ACTIVE_STATUSES.includes(j.status)) ?? null;
  // Transcripts restored from an earlier visit aren't part of this run.
  const sessionJobs = jobs.filter((j) => !j.restored);
  const processed = sessionJobs.filter(
    (j) => j.status === "done" || j.status === "error",
  ).length;
  const busy = state.status === "loading" || !!activeJob;

  return (
    <I18nContext.Provider value={t}>
    <div className="mx-auto max-w-3xl px-4 pt-[33.2px] pb-10 sm:pt-[48.4px] sm:pb-14">
      <LanguageSwitch
        value={settings.uiLanguage}
        onChange={(uiLanguage) => patchSettings({ uiLanguage })}
      />
      {/* Header */}
      <header className="mb-16 text-center">
        <h1 className="mb-4 flex justify-center">
          <Logo className="sm:w-[462px]" />
        </h1>
        <p className="mx-auto max-w-md text-base text-neutral-400">
          {t.header.tagline}
        </p>
      </header>

      {/* The recording's language (it also picks the model), with the privacy and FAQ badges beside it */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <RecordingLanguage
          value={spokenLanguage(settings)}
          onChange={setSpokenLanguage}
          disabled={state.status === "loading"}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-mint-300 px-3 py-1.5 text-xs font-semibold text-ink">
            <ShieldCheck className="size-4" />
            {t.header.onDevice}
          </span>
          <Faq />
        </div>
      </div>

      {/* Source tabs */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            // The hint is a sibling of the button, not inside it, so it isn't read
            // as part of the tab's name — only once, as its description.
            <div key={tab.id} className="group relative">
              <button
                type="button"
                onClick={() => setTab(tab.id)}
                aria-describedby={`tab-hint-${tab.id}`}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20"
                    : "bg-[var(--color-surface)]/60 text-neutral-300 ring-1 ring-inset ring-[var(--color-border)] hover:bg-white/[0.04]"
                }`}
              >
                <Icon className="size-4" />
                {t.tabs[tab.id]}
              </button>
              {/* A short hint above the tab, after a brief hover or on keyboard focus. */}
              <span
                id={`tab-hint-${tab.id}`}
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[15rem] -translate-x-1/2 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-center text-xs font-medium text-neutral-900 opacity-0 shadow-lg shadow-black/40 transition-opacity group-hover:opacity-100 group-hover:delay-300 group-has-[:focus-visible]:opacity-100"
              >
                {t.tabHints[tab.id]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Source area */}
      <div className="mt-[22.5px]">
        {activeTab === "files" && <Dropzone onFiles={onFiles} />}
        {activeTab === "mic" && (
          <Card className="p-4">
            <Recorder onRecorded={onRecorded} />
          </Card>
        )}
        {activeTab === "podcast" && (
          <Card className="p-5">
            <PodcastPanel proxyBase={proxyBase} onEnqueue={onEnqueueEpisodes} />
          </Card>
        )}
      </div>

      {/* A failed model load stops the queue, so say so here, not only inside Settings.
          The download button below doubles as "try again". */}
      {state.status === "error" && state.error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {t.model.failed(state.error)}
        </p>
      )}

      {/* Optional: pre-load the model when idle — right under the drop area, so the
          settings panel can open directly beneath its own button. */}
      {!loadedForModel && state.status !== "loading" && (
        <button
          type="button"
          onClick={handleLoad}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-2 text-sm text-neutral-300 transition hover:border-brand-400/30 hover:text-white"
        >
          <Download className="size-4" />
          {t.model.preDownload(modelName(model.name, t), formatSize(tierSizeMB(currentTier, gpuF16)))}
        </button>
      )}

      {/* Settings toggle (the model's name, size and progress show in the
          download button and the loading panel) */}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
          // An outlined sienna button: clearly clickable, but quieter than the solid active tab.
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            showSettings
              ? "border-brand-400 bg-brand-500/15 text-brand-200"
              : "border-brand-400/60 text-brand-300 hover:border-brand-400 hover:bg-brand-500/10 hover:text-brand-200"
          }`}
        >
          <Sliders className="size-4" />
          {t.settings.toggle}
          <ChevronDown
            className={`size-4 transition ${showSettings ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Advanced settings drawer */}
      {showSettings && (
        <Card className="mt-3 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-300">
            <Sparkles className="size-4 text-brand-300" /> {t.settings.heading}
          </div>
          <AdvancedSettings
            settings={settings}
            onChange={patchSettings}
            resolvedDevice={resolvedDevice}
            webgpuAvailable={webgpuAvailable}
            gpuF16={gpuF16}
            disabled={state.status === "loading"}
          />
          {state.status === "ready" && !loadedForModel && (
            <button
              type="button"
              onClick={handleLoad}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              <Download className="size-4" /> {t.settings.applyReload}
            </button>
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
        <p className="mt-5 text-xs text-amber-300">{t.saveFailed}</p>
      )}

      <div className="mt-5">
        <JobQueue
          jobs={jobs}
          onDownload={onManualDownload}
          onRenameSpeaker={onRenameSpeaker}
          onEditChunk={onEditChunk}
          onRevertChunk={onRevertChunk}
          onReplaceChunks={onReplaceChunks}
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

      <footer className="mt-12 border-t border-[var(--color-border)] pt-6 text-center text-xs text-neutral-500">
        <p>
          <strong className="font-semibold text-neutral-300">Vem sa vad?</strong> {t.footer.by}{" "}
          <a
            href="https://mickequick.se"
            className="font-medium text-neutral-300 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Micke Quick
          </a>
          ,{" "}
          <a
            href="https://promptagency.se"
            className="font-medium text-neutral-300 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Prompt Agency
          </a>{" "}
          ·{" "}
          <a
            href="https://github.com/promptagency/vem-sa-vad"
            className="text-neutral-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {t.footer.source}
          </a>
        </p>
        <p className="mt-2">
          {t.footer.basedOn}{" "}
          <a
            href="https://github.com/fltman/bjarbys-transcriber"
            className="text-neutral-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Bjarbys Transcriber
          </a>{" "}
          {t.footer.byAuthor} <span className="font-medium text-neutral-300">Anders Bjarby</span>
        </p>
        <p className="mt-2">
          {t.footer.poweredBy}{" "}
          <a
            href="https://github.com/huggingface/transformers.js"
            className="text-neutral-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Transformers.js
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/KBLab"
            className="text-neutral-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            KB-Whisper
          </a>{" "}
          ·{" "}
          <a
            href="https://huggingface.co/pyannote/segmentation-3.0"
            className="text-neutral-400 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            pyannote
          </a>{" "}
          · {t.footer.cached}
        </p>
      </footer>
    </div>
    </I18nContext.Provider>
  );
}
