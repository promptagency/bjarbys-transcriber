import { languageName, useT } from "../lib/i18n";
import { LANGUAGES } from "../lib/settings";

/** Swedish and English first (each has its own model), then auto-detect and the rest. */
const OTHERS = LANGUAGES.filter((l) => l.code && l.code !== "sv" && l.code !== "en");

/**
 * The language spoken in the recording — one compact control instead of a row
 * of cards. The model follows the choice (see forSpokenLanguage).
 */
export function RecordingLanguage({
  value,
  onChange,
  disabled,
}: {
  /** A language code, or null for auto-detect. */
  value: string | null;
  onChange: (code: string | null) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <label className="flex items-center justify-center gap-2 text-sm text-slate-400">
      {t.spokenLanguage}
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1.5 pl-2.5 pr-8 text-sm font-medium text-slate-100 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20 disabled:opacity-50"
      >
        <option value="sv">🇸🇪 {languageName("sv", t)}</option>
        <option value="en">🇬🇧 {languageName("en", t)}</option>
        <option value="">🌍 {t.settings.autoDetect}</option>
        <optgroup label={t.otherLanguages}>
          {OTHERS.map((l) => (
            <option key={l.code} value={l.code!}>
              {languageName(l.code!, t)}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
