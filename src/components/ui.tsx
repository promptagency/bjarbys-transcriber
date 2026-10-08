import {
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  cloneElement,
  useId,
} from "react";
import { Info } from "lucide-react";
import { useT } from "../lib/i18n";

export function ProgressBar({
  value,
  className = "",
}: {
  value: number; // 0..1
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)] ${className}`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-2)] transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label={t.processing.working}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "green" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/5 text-slate-300 ring-white/10",
    brand: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
    green: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    amber: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
    red: "bg-red-500/15 text-red-300 ring-red-400/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * A small ⓘ that shows a short explanation on hover, focus or tap. A button,
 * so inside a <label> clicking it doesn't toggle or open the control.
 */
export function InfoTip({ text }: { text: string }) {
  const t = useT();
  const id = useId();
  return (
    <span className="group/tip relative inline-flex align-middle normal-case tracking-normal">
      <button
        type="button"
        aria-label={t.settings.moreInfo}
        aria-describedby={id}
        onClick={(e) => e.preventDefault()}
        className="rounded-full p-0.5 text-slate-500 transition hover:text-sky-300 focus-visible:text-sky-300 focus-visible:outline-none"
      >
        <Info className="size-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-max max-w-[17rem] -translate-x-2 rounded-lg bg-slate-100 px-2.5 py-1.5 whitespace-pre-line text-left text-xs font-medium leading-relaxed text-slate-900 opacity-0 shadow-lg shadow-black/40 transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-200 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function Field({
  label,
  hint,
  tip,
  children,
}: {
  label: string;
  hint?: string;
  /** A short explanation, shown from an ⓘ beside the label. */
  tip?: string;
  /** The one control the label names (it gets an id to point at). */
  children: ReactElement<{ id?: string }>;
}) {
  // The label points at its control by id rather than wrapping it: a <label>
  // names the first control inside it, which would be the ⓘ button.
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="inline-flex items-center gap-1">
          <label
            htmlFor={id}
            className="text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            {label}
          </label>
          {tip && <InfoTip text={tip} />}
        </span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {cloneElement(children, { id })}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
