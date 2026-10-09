import { useEffect, useRef, useState } from "react";
import { Download, Plus, Search, Upload, X } from "lucide-react";
import { type Strings, useT } from "../lib/i18n";
import { MAX_TERMS, addTerms, glossaryTerms, removeTerm } from "../lib/glossary";

/** A word list file larger than this is not a word list. */
const MAX_IMPORT_BYTES = 1_000_000;

/**
 * The word list (Ordlista) in a dialog: search, add (several pasted lines at
 * once), remove, and import/export as a plain text file — the list lives
 * only in this browser, so a file is how it moves to another computer or a
 * colleague. Opened from Settings and from the review view's word-list panel.
 */
export function GlossaryDialog({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  /** The list as stored: one term per line. */
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const g = t.glossaryDialog;
  const dialog = useRef<HTMLDialogElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const addInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  // A function of the strings, so it follows a language switch.
  const [note, setNote] = useState<((t: Strings) => string) | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setNote(null);
      setQuery("");
      d.showModal();
      // Start in the add field, not on the close button that comes first.
      addInput.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  const terms = glossaryTerms(value);
  const needle = query.trim().toLowerCase();
  const shown = needle ? terms.filter((term) => term.toLowerCase().includes(needle)) : terms;

  function add(lines: string[]) {
    const result = addTerms(value, lines);
    if (result.added.length) onChange(result.text);
    const n = result.added.length;
    setNote(() =>
      result.full
        ? (t: Strings) => (n ? `${t.glossaryDialog.added(n)} ` : "") + t.glossaryDialog.full(MAX_TERMS)
        : (t: Strings) => (n ? t.glossaryDialog.added(n) : t.glossaryDialog.nothingNew),
    );
  }

  function submit() {
    if (!draft.trim()) return;
    add(draft.split(/\r?\n/));
    setDraft("");
  }

  async function importFile(file: File) {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("too large");
      add((await file.text()).split(/\r?\n/));
    } catch {
      setNote(() => (t: Strings) => t.glossaryDialog.readFailed);
    }
  }

  function exportFile() {
    // Windows line endings, so Notepad shows one term per line too.
    const blob = new Blob([terms.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = g.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="glossary-title"
      onClose={onClose}
      // A click on the backdrop (the dialog element itself, outside its content) closes it.
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-left text-neutral-300 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 id="glossary-title" className="text-lg font-bold text-neutral-100">
            {g.title}
            {terms.length > 0 && (
              <span className="ml-2 text-sm font-normal text-neutral-500">{terms.length}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={g.close}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-3 border-b border-[var(--color-border)] px-5 py-4">
          <p className="text-sm leading-relaxed text-neutral-400">{g.intro}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={addInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                // Several lines pasted at once: add them all, rather than
                // squashing them into one line of the input.
                const text = e.clipboardData.getData("text");
                if (!/\r?\n/.test(text.trim())) return;
                e.preventDefault();
                add(text.split(/\r?\n/));
              }}
              placeholder={g.addPlaceholder}
              aria-label={g.addPlaceholder}
              maxLength={200}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-500 focus:border-lavender-300/60 focus:ring-2 focus:ring-lavender-300/20"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-lavender-300 px-3 py-2 text-sm font-semibold text-ink hover:bg-lavender-200 disabled:opacity-40"
            >
              <Plus className="size-4" /> {g.add}
            </button>
          </form>
          {note && (
            <p role="status" className="text-xs text-neutral-300">
              {note(t)}
            </p>
          )}
        </div>

        {terms.length > 6 && (
          <div className="px-5 pt-3">
            <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 focus-within:border-lavender-300/60">
              <Search className="size-4 shrink-0 text-neutral-500" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={g.search}
                aria-label={g.search}
                className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              />
            </label>
          </div>
        )}

        <div className="min-h-24 overflow-y-auto px-5 py-3 scroll-thin">
          {shown.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-500">{terms.length ? g.noMatch : g.empty}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {shown.map((term) => (
                <li key={term} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">{term}</span>
                  <button
                    type="button"
                    onClick={() => onChange(removeTerm(value, term))}
                    aria-label={g.remove(term)}
                    title={g.remove(term)}
                    className="shrink-0 rounded p-1 text-neutral-500 hover:bg-white/5 hover:text-red-300"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // the same file can be chosen again
              if (file) void importFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
          >
            <Upload className="size-3.5" /> {g.importFile}
          </button>
          <button
            type="button"
            onClick={exportFile}
            disabled={terms.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40"
          >
            <Download className="size-3.5" /> {g.exportFile}
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="ml-auto rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-neutral-200 hover:bg-white/5"
          >
            {g.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
