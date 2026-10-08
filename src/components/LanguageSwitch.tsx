import { LANGS, type Lang, STRINGS } from "../lib/i18n";

/** Svenska / English, top right. */
export function LanguageSwitch({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const t = STRINGS[value];
  return (
    <div className="-mt-4 mb-4 flex justify-end sm:-mt-6">
      <div
        role="group"
        aria-label={t.uiLanguage.label}
        className="flex rounded-lg p-0.5 text-xs ring-1 ring-inset ring-[var(--color-border)]"
      >
        {LANGS.map((lang) => (
          <button
            key={lang}
            type="button"
            lang={lang}
            aria-pressed={value === lang}
            title={t.uiLanguage[lang]}
            onClick={() => onChange(lang)}
            className={`rounded-md px-2 py-1 font-semibold uppercase transition ${
              value === lang ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {lang}
          </button>
        ))}
      </div>
    </div>
  );
}
