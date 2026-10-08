import { useRef, useState } from "react";
import { FileAudio, Upload } from "lucide-react";
import { ACCEPTED_EXTS } from "../lib/audio";
import { useT } from "../lib/i18n";

const ACCEPT = ["audio/*", "video/*", ...ACCEPTED_EXTS.map((e) => `.${e}`)].join(
  ",",
);

export function Dropzone({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled)
          inputRef.current?.click();
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-16 text-center transition sm:py-20 ${
        hover
          ? "scale-[1.01] border-sky-400/70 bg-sky-400/[0.06]"
          : // The same surface as the Spela in and Podd panels (Card).
            "border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur hover:border-sky-400/40"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/20 to-cyan-400/10 text-sky-300 ring-1 ring-sky-400/20 transition group-hover:scale-110 group-hover:rotate-3">
        {hover ? (
          <Upload className="size-9" />
        ) : (
          <FileAudio className="size-9" />
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-100">
          {hover ? t.dropzone.dropping : t.dropzone.drop}
        </p>
        <p className="mt-1.5 text-base text-slate-400">{t.dropzone.browse}</p>
      </div>
      <p className="max-w-md text-xs text-slate-500">
        MP3 · WAV · M4A · OGG · FLAC · MP4 · MOV · WebM — {t.dropzone.formats}
      </p>
    </div>
  );
}
