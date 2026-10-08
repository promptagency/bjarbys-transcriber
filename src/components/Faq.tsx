import { useRef } from "react";
import { ChevronDown, CircleHelp, ExternalLink, X } from "lucide-react";
import { useT } from "../lib/i18n";

/**
 * "Vanliga frågor": a badge beside the privacy badge that opens the FAQ in a
 * dialog. The native <dialog> gives Esc to close, focus handling and a backdrop.
 */
export function Faq() {
  const t = useT();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-400/20 transition hover:bg-violet-500/20 hover:text-violet-200"
      >
        <CircleHelp className="size-4" />
        {t.faq.badge}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="faq-title"
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-auto max-h-[85vh] w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-left text-slate-300 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <h2 id="faq-title" className="text-lg font-bold text-slate-100">
              {t.faq.title}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t.faq.close}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto px-5 py-4 scroll-thin">
            {t.faq.items.map((item, i) => (
              <details
                key={i}
                // One shared name makes it an accordion: opening one closes the others.
                name="faq"
                open={i === 0}
                className="group rounded-xl border border-[var(--color-border)] bg-white/[0.02] open:bg-white/[0.04]"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className="space-y-2 px-4 pb-4 text-sm leading-relaxed text-slate-200">
                  {item.a.map((paragraph, j) => (
                    <p key={j}>{paragraph}</p>
                  ))}
                  {item.list && (
                    <ul className="list-disc space-y-1.5 pl-5 marker:text-violet-300">
                      {item.list.map((point, j) => (
                        <li key={j}>{point}</li>
                      ))}
                    </ul>
                  )}
                  {item.link && (
                    <a
                      href={item.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-violet-300 underline-offset-2 hover:underline"
                    >
                      {item.link.label}
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
