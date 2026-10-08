import { useEffect, useState } from "react";
import { Cpu, Loader2, Zap } from "lucide-react";
import { type Job, jobProgress } from "../lib/jobs";
import type { ModelState } from "../hooks/useWhisper";
import { formatMessage, useT } from "../lib/i18n";

/** Animated equalizer bars. */
export function WaveBars({
  count = 5,
  className = "",
  active = true,
}: {
  count?: number;
  className?: string;
  active?: boolean;
}) {
  const delays = [0, 0.18, 0.36, 0.12, 0.28, 0.42, 0.06];
  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-gradient-to-t from-brand-500 to-brand-300 ${
            active ? "eq-bar" : ""
          }`}
          style={{
            height: "100%",
            animationDelay: `${delays[i % delays.length]}s`,
            opacity: active ? 1 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

/** Circular gradient progress ring with a percentage label. */
export function ProgressRing({
  value,
  size = 116,
  stroke = 9,
  indeterminate = false,
  label,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  indeterminate?: boolean;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const dash = indeterminate ? c * 0.25 : c * pct;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className={indeterminate ? "spin-slow" : ""}
        style={{ transform: indeterminate ? undefined : "rotate(-90deg)" }}
      >
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-brand-500)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-brand-300)" }} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: indeterminate ? undefined : "stroke-dasharray 0.3s" }}
        />
      </svg>
      {!indeterminate && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-neutral-100">
            {Math.round(pct * 100)}
            <span className="text-sm text-neutral-400">%</span>
          </span>
          {label && (
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The "now processing" hero. Shows model-download progress while loading, then
 * a live equalizer + queue progress while jobs run.
 */
/** How long the download may stand still before the panel says the server is slow. */
const SLOW_SERVER_MS = 10_000;

export function ProcessingHero({
  state,
  activeJob,
  done,
  total,
}: {
  state: ModelState;
  activeJob: Job | null;
  done: number;
  total: number;
}) {
  const t = useT();
  const loading = state.status === "loading";
  const downloading = loading && state.overall < 1;

  // Hugging Face's CDN can take a long while to start sending a file it hasn't
  // served recently, and the bar then stands still. After 10 s without
  // progress, say so — it looks frozen otherwise. Any progress resets it.
  const [slowServer, setSlowServer] = useState(false);
  useEffect(() => {
    setSlowServer(false);
    if (!downloading) return;
    const timer = window.setTimeout(() => setSlowServer(true), SLOW_SERVER_MS);
    return () => window.clearTimeout(timer);
  }, [downloading, state.overall]);

  const hasWork = loading || !!activeJob;
  if (!hasWork) return null;

  const activeFraction = activeJob ? jobProgress(activeJob) : 0;
  const queuePct = total > 0 ? (done + activeFraction) / total : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-400/20 bg-gradient-to-br from-brand-500/[0.07] to-brand-400/[0.04] p-5">
      <div className="flex items-center gap-5">
        {loading ? (
          <ProgressRing value={state.overall} label={t.processing.ringDownload} />
        ) : activeJob?.status === "transcribing" ? (
          <ProgressRing value={activeJob.stageProgress} label={t.processing.ringTranscribing} />
        ) : activeJob?.status === "diarizing" ? (
          <ProgressRing value={activeJob.stageProgress} label={t.processing.ringSpeakers} />
        ) : (
          <ProgressRing value={0} indeterminate label="" />
        )}

        <div className="min-w-0 flex-1">
          {loading ? (
            <>
              <p className="flex items-center gap-2 text-base font-semibold text-neutral-100">
                <Loader2 className="size-4 animate-spin text-brand-300" />
                {t.processing.downloadingModel}
              </p>
              <p className="mt-1 truncate text-sm text-neutral-400">
                {t.processing.cachedAfter(Math.round(state.overall * 100))}
              </p>
              {slowServer && downloading && (
                <p role="status" className="mt-1 text-sm text-amber-200/90">
                  {t.processing.slowServer}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
                {state.device === "webgpu" ? (
                  <Zap className="size-3.5 text-brand-300" />
                ) : (
                  <Cpu className="size-3.5" />
                )}
                {t.processing.preparing(state.device === "webgpu" ? "GPU" : "CPU")}
              </div>
            </>
          ) : activeJob ? (
            <>
              <div className="flex items-center gap-3">
                <WaveBars className="h-7 w-14" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-neutral-100">
                    {t.processing.stage[activeJob.status] ?? t.processing.working}
                  </p>
                  <p className="truncate text-sm text-neutral-400">
                    {activeJob.label}
                  </p>
                </div>
              </div>

              {activeJob.warning && (
                <p className="mt-3 text-sm text-amber-300">
                  {formatMessage(t, activeJob.warning)}
                </p>
              )}

              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-neutral-400">
                  <span>{t.processing.queueProgress}</span>
                  <span className="tabular-nums">{t.processing.done(done, total)}</span>
                </div>
                <div className="shimmer-track h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-300"
                    style={{ width: `${queuePct * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
