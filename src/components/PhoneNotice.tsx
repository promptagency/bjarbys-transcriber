import { useEffect, useState } from "react";
import { Check, FileAudio, Laptop, Share2 } from "lucide-react";
import { type Lang, STRINGS } from "../lib/i18n";
import { restoreSettings } from "../lib/settings";
import { loadSettingsRaw, saveSettings } from "../lib/storage";
import { LanguageSwitch } from "./LanguageSwitch";

/**
 * Shown on phones instead of the app (see src/lib/device.ts): open it on a
 * computer, with a way to send the link there and a way past for the curious.
 */
export function PhoneNotice({ onContinue }: { onContinue: () => void }) {
  const [lang, setLang] = useState<Lang>(() => restoreSettings(loadSettingsRaw()).uiLanguage);
  const [copied, setCopied] = useState(false);
  const t = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.meta.title;
  }, [lang, t]);

  function changeLanguage(next: Lang) {
    setLang(next);
    // The app reads the same setting, so the choice carries over.
    saveSettings({ ...restoreSettings(loadSettingsRaw()), uiLanguage: next });
  }

  async function share() {
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: "Vem sa vad?", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed, or clipboard unavailable — nothing to do */
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col px-5 py-10">
      <LanguageSwitch value={lang} onChange={changeLanguage} />
      <div className="mb-8 flex items-center justify-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 text-white shadow-lg shadow-sky-500/20">
          <FileAudio className="size-7" />
        </div>
        <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
          Vem sa vad?
        </h1>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-6 text-center">
        <Laptop className="mx-auto mb-4 size-10 text-sky-300" />
        <h2 className="text-xl font-bold text-slate-100">{t.phone.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{t.phone.why}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{t.phone.how}</p>
        <button
          type="button"
          onClick={share}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-600"
        >
          {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
          {copied ? t.phone.copied : t.phone.share}
        </button>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mx-auto mt-6 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
      >
        {t.phone.continue}
      </button>
    </div>
  );
}
