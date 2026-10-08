// Interface text in Swedish (the default) and English. Swedish is the master:
// `en` must have exactly the same shape, so a missing translation fails the
// build. Entries that need numbers or names are functions.
//
// Developer-facing text (the benchmark page, logs, code comments) stays English.
import { createContext, useContext } from "react";
import type { Dtype, ModelGroup } from "./models";
import type { ExportFormat } from "./exporters";
import type { JobStatus } from "./jobs";

export type Lang = "sv" | "en";
export const LANGS: Lang[] = ["sv", "en"];
export const DEFAULT_LANG: Lang = "sv";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const sv = {
  locale: "sv-SE",
  meta: {
    title: "Vem sa vad? — privat transkribering i webbläsaren",
    description:
      "Gör tal till text privat — Whisper körs helt i din webbläsare. Inget laddas upp.",
  },
  uiLanguage: { label: "Språk", sv: "Svenska", en: "English" },
  header: {
    tagline: "Gör tal till text — privat, direkt i webbläsaren.",
    nothingUploaded: "Inget laddas upp ✨",
    onDevice: "100 % på din enhet",
  },
  spokenLanguage: "Språk i inspelningen",
  otherLanguages: "Andra språk",
  tabs: { files: "Filer", mic: "Spela in", podcast: "Podd" },
  model: {
    loading: (pct: number) => `laddar ${pct} %`,
    ready: "redo",
    loadsOnFirstFile: (size: string) => `${size} · laddas vid första filen`,
    preDownload: (name: string, size: string) => `Ladda ned ${name} i förväg (${size})`,
  },
  settings: {
    toggle: "Inställningar",
    heading: "Finjustera",
    applyReload: "Använd och ladda om modellen",
    model: "Modell",
    coverage: {
      "Swedish — KB-Whisper": "Svenska (klarar även engelska)",
      "Multilingual — Whisper": "~100 språk",
      "English — Whisper": "Bara engelska",
    } satisfies Record<ModelGroup, string>,
    group: {
      "Swedish — KB-Whisper": "Svenska — KB-Whisper",
      "Multilingual — Whisper": "Flerspråkig — Whisper",
      "English — Whisper": "Engelska — Whisper",
    } satisfies Record<ModelGroup, string>,
    quality: "Kvalitet / storlek",
    download: (size: string) => `${size} att ladda ned`,
    dtype: {
      q4f16: "Balanserad (GPU)",
      q4: "4-bitars",
      q8: "Balanserad (CPU)",
      fp16: "16-bitars",
      fp32: "Full kvalitet (störst)",
    } satisfies Record<Dtype, string>,
    runOn: "Kör på",
    webgpuFound: "WebGPU finns",
    webgpuMissing: "WebGPU saknas",
    auto: (device: string) => `Automatiskt (${device})`,
    gpu: (available: boolean) => `GPU — WebGPU${available ? "" : " (inte tillgängligt)"}`,
    cpu: "CPU — WASM",
    formats: "Filformat",
    formatsZip: "transkriberas en gång · sparas som .zip",
    formatsOne: "transkriberas en gång per fil",
    format: {
      txt: "Dokument (.txt)",
      md: "Dokument (.md)",
      srt: "Undertexter (.srt)",
      vtt: "WebVTT (.vtt)",
      json: "JSON (.json)",
      lines: "Rader (.txt)",
    } satisfies Record<ExportFormat, string>,
    timestamps: "Tidsstämplar i dokument ([00:09] före varje stycke)",
    englishOnlyModel: "modell för bara engelska",
    /** Replaces "(English)" in the names of the English-only models. */
    englishSuffix: "(engelska)",
    autoDetect: "Känn igen automatiskt",
    task: "Uppgift",
    taskHint: "översätt → engelska",
    transcribe: "Transkribera (samma språk)",
    translate: "Översätt till engelska",
    autoDownload: "Ladda ned varje transkription automatiskt när den är klar",
    diarize:
      "Dela upp på talare (experimentellt — märker varje rad ”Talare 1”, ”Talare 2” osv.)",
    keep: "Spara klara transkriptioner i den här webbläsaren efter en omladdning",
    keepHint:
      "De ligger kvar tills du tar bort dem, och alla som använder webbläsaren kan öppna dem — låt det vara av på en delad dator. Stänger du av det raderas de sparade kopiorna.",
  },
  saveFailed:
    "Webbläsaren vägrade spara en transkription (ett privat fönster, eller lagringen är full eller blockerad), så den kan saknas efter en omladdning. Ladda ned det du vill behålla.",
  footer: {
    by: "Vem sa vad? av",
    source: "Källkod på GitHub",
    basedOn: "Bygger på",
    byAuthor: "av",
    poweredBy: "Drivs av",
    cached: "modellerna laddas ned en gång och sparas i webbläsaren.",
  },
  dropzone: {
    drop: "Släpp ljud eller video här",
    dropping: "Släpp dem! 🎉",
    browse: "eller klicka för att välja — lägg till så många du vill",
    formats: "transkriberas en i taget, 100 % på din enhet.",
  },
  recorder: {
    placeholder: "Din röst syns här när du pratar",
    start: "Starta inspelningen",
    stop: "Stoppa inspelningen",
    title: "Spela in från mikrofonen",
    recording: "Spelar in… klicka för att stoppa och transkribera",
    idle: "Klicka på mikrofonen, prata och stoppa sedan för att lägga inspelningen i kön",
    insecure:
      "Mikrofonen kräver en säker anslutning (HTTPS eller localhost). Den är inte tillgänglig här.",
    denied: "Åtkomst till mikrofonen nekades.",
    failed: (detail: string) => `Kunde inte starta inspelningen: ${detail}`,
    fileName: "inspelning",
  },
  podcast: {
    back: "Tillbaka",
    loadingEpisodes: "Laddar avsnitt…",
    selectAll: "Markera alla",
    deselectAll: "Avmarkera alla",
    episodes: (n: number) => `${n} avsnitt`,
    add: (n: number) => (n ? `Lägg till ${n} i kön` : "Lägg till i kön"),
    noEpisodes: "Inga spelbara avsnitt hittades i flödet.",
    placeholder: "Sök efter en podd…",
    search: "Sök",
    intro:
      "Hitta en podd och välj avsnitt, så transkriberas de lokalt — ljudet hämtas via den här sidans egen server, aldrig via någon tredje part.",
    searchFailed: (detail: string) => `Sökningen misslyckades: ${detail}`,
    loadFailed: (detail: string) => `Kunde inte ladda avsnitten: ${detail}`,
  },
  processing: {
    stage: {
      fetching: "Laddar ned avsnittet",
      decoding: "Avkodar ljudet",
      transcribing: "Transkriberar tal",
      diarizing: "Delar upp på talare",
    } as Partial<Record<JobStatus, string>>,
    working: "Arbetar",
    ringDownload: "nedladdning",
    ringTranscribing: "transkribering",
    ringSpeakers: "talare",
    downloadingModel: "Laddar ned modellen",
    cachedAfter: (pct: number) => `${pct} % · sparas i webbläsaren efter första gången`,
    preparing: (device: string) => `Förbereder körning på ${device}`,
    queueProgress: "Förlopp i kön",
    done: (done: number, total: number) => `${done} av ${total} klara`,
  },
  queue: {
    title: (n: number) => `Kö · ${n}`,
    deleteFinished: "Ta bort alla klara",
    deleteFinishedTitle: "Tar bort alla klara transkriptioner från listan och från webbläsaren",
    askTitle: "Spara klara transkriptioner om du laddar om sidan?",
    askBefore: "Säger du ja sparas de i den här webbläsaren (aldrig uppladdade) och ",
    askStay: "ligger kvar tills du tar bort dem",
    askAfter:
      " — alla som använder webbläsaren kan öppna dem. Säger du nej försvinner de när du stänger eller laddar om sidan, så ladda ned det du behöver. Du kan ändra det senare under Inställningar.",
    yesKeep: "Ja, spara dem",
    noThanks: "Nej tack",
    restored: (n: number) =>
      `Återställde ${n} ${plural(n, "transkription", "transkriptioner")} från ditt förra besök.`,
    keptBefore: "Klara transkriptioner ",
    keptStay: "sparas i den här webbläsaren och ligger kvar tills du tar bort dem",
    keptAfter: " — med ✕ på var och en, eller ",
    keptDeleteAll: "Ta bort alla klara",
    keptEnd: ". På en delad dator: ta bort dem när du är klar.",
    status: {
      queued: "I kö",
      downloading: (pct: number) => `Laddar ned… ${pct} %`,
      decoding: "Avkodar",
      transcribing: (pct: number) => `Transkriberar… ${pct} %`,
      diarizing: (pct: number) => `Delar upp på talare… ${pct} %`,
      done: "Klar",
      failed: "Misslyckades",
    },
    noSpeech: "(inget tal hittades)",
    show: "Visa transkriptionen",
    download: "Ladda ned transkriptionen",
    remove: "Ta bort",
    copy: "Kopiera",
    copied: "Kopierat",
    livePreview: "Förhandsvisning · den färdiga transkriptionen kan skilja sig något",
    nameSpeakers: "Namnge talarna",
    namesHint:
      "Namnen används i transkriptionen, vid kopiering och i nedladdningar. En fil som laddades ned automatiskt har kvar ”Talare 1” — ladda ned den igen när du har namngett talarna.",
  },
  review: {
    onlyUnsure: (n: number) => `Bara osäkra rader (${n})`,
    findReplace: "Sök och ersätt",
    detectedTitle: "Känt igen automatiskt från de första 30 sekunderna",
    detected: (name: string) => `Igenkänt språk: ${name}`,
    restored:
      "Återställd efter en omladdning · ljudet sparas inte, så rader kan inte spelas upp · klicka på texten för att redigera",
    noPlayback: "Uppspelning fungerar inte för den här filen i webbläsaren.",
    hint: "Klicka på ▶ för att höra en rad · klicka på texten för att redigera",
    find: "Sök",
    replaceWith: "Ersätt med",
    matchCase: "Skilj på stora och små bokstäver",
    wholeWords: "Hela ord",
    onlyMatches: "Bara rader med träffar",
    matches: (m: number, lines: number) =>
      `${m} ${plural(m, "träff", "träffar")} på ${lines} ${plural(lines, "rad", "rader")}`,
    alreadyReplaced: (n: number) => ` · ${n} redan som ersättningen`,
    replaceAll: "Ersätt alla",
    finishEditing: "Spara raden du redigerar först",
    undo: "Ångra",
    replaced: (m: number, lines: number) =>
      `Ersatte ${m} ${plural(m, "träff", "träffar")} på ${lines} ${plural(lines, "rad", "rader")}.`,
    undone: "Ångrat.",
    undoneKept: (n: number) =>
      `Ångrat. ${n} ${plural(n, "rad", "rader")} som du har ändrat sedan dess lämnades som ${plural(n, "den", "de")} var.`,
    noMatches: "Inga rader matchar.",
    noUnsure: "Inga osäkra rader kvar.",
    stop: "Stoppa",
    play: "Spela upp raden",
    unsureTitle: "Modellen var osäker på vem som sa detta",
    speaker: "Talare",
    newSpeaker: "Ny talare",
    noSpeaker: "Ingen talare",
    clickToEdit: "Klicka för att redigera",
    removed: "(borttagen)",
    revert: "Ångra mina ändringar på raden",
  },
  /** Text inside downloaded files and copied text. */
  export: {
    speaker: (n: number) => `Talare ${n}`,
    speakers: "Talare",
    untitled: "Transkription",
  },
  /** Messages that code produces as data (job warnings and errors), so they follow the language. */
  msg: {
    diarizeTooLong: (p: { minutes: number; limit: number }) =>
      `Talaruppdelningen hoppades över: inspelningen är ${p.minutes} min, längre än gränsen på ${p.limit} min.`,
    diarizeFailed: (p: { detail: string }) => `Talaruppdelningen misslyckades: ${p.detail}`,
    undecodable: () =>
      "Webbläsaren kunde inte avkoda ljudet i filen. Prova MP3, WAV, M4A, OGG, FLAC eller en MP4-, MOV- eller WebM-video.",
    podcastFetch: (p: { proxy: "none" | "status" | "unreachable"; detail: string }) =>
      `Kunde inte hämta podden: ${
        p.proxy === "none"
          ? "ingen proxy körs här"
          : p.proxy === "status"
            ? `proxyn svarade HTTP ${p.detail}`
            : `proxyn gick inte att nå (${p.detail})`
      }, och servern tillåter inte direkt åtkomst. Kör \`npm run dev\`, eller lägg proxy.php (PHP + cURL) bredvid appen.`,
    searchHttp: (p: { status: number }) => `Poddsökningen misslyckades (HTTP ${p.status}).`,
    badFeed: () => "Flödet är inte giltig RSS/XML.",
    workerCrashed: () => "Transkriberingen stannade oväntat.",
  },
};

export type Strings = typeof sv;

const en: Strings = {
  locale: "en-GB",
  meta: {
    title: "Vem sa vad? — private, in-browser transcription",
    description:
      "Transcribe audio to text privately — Whisper runs entirely in your browser. Nothing is uploaded.",
  },
  uiLanguage: { label: "Language", sv: "Svenska", en: "English" },
  header: {
    tagline: "Turn talking into text — privately, right in your browser.",
    nothingUploaded: "Nothing is uploaded ✨",
    onDevice: "100% on your device",
  },
  spokenLanguage: "Language spoken",
  otherLanguages: "Other languages",
  tabs: { files: "Files", mic: "Record", podcast: "Podcast" },
  model: {
    loading: (pct) => `loading ${pct}%`,
    ready: "ready",
    loadsOnFirstFile: (size) => `${size} · loads on first file`,
    preDownload: (name, size) => `Pre-download ${name} (${size})`,
  },
  settings: {
    toggle: "Settings",
    heading: "Fine-tune",
    applyReload: "Apply & reload model",
    model: "Model",
    coverage: {
      "Swedish — KB-Whisper": "Swedish (also handles English)",
      "Multilingual — Whisper": "~100 languages",
      "English — Whisper": "English only",
    },
    group: {
      "Swedish — KB-Whisper": "Swedish — KB-Whisper",
      "Multilingual — Whisper": "Multilingual — Whisper",
      "English — Whisper": "English — Whisper",
    },
    quality: "Quality / size",
    download: (size) => `${size} download`,
    dtype: {
      q4f16: "Balanced (GPU)",
      q4: "4-bit",
      q8: "Balanced (CPU)",
      fp16: "16-bit",
      fp32: "Full quality (largest)",
    },
    runOn: "Run on",
    webgpuFound: "WebGPU detected",
    webgpuMissing: "WebGPU unavailable",
    auto: (device) => `Auto (${device})`,
    gpu: (available) => `GPU — WebGPU${available ? "" : " (not available)"}`,
    cpu: "CPU — WASM",
    formats: "Output formats",
    formatsZip: "transcribed once · saved as a .zip",
    formatsOne: "transcribed once per file",
    format: {
      txt: "Document (.txt)",
      md: "Document (.md)",
      srt: "Subtitles (.srt)",
      vtt: "WebVTT (.vtt)",
      json: "JSON (.json)",
      lines: "Lines (.txt)",
    },
    timestamps: "Timestamps in documents ([00:09] before each paragraph)",
    englishOnlyModel: "English-only model",
    englishSuffix: "(English)",
    autoDetect: "Auto-detect",
    task: "Task",
    taskHint: "translate → English",
    transcribe: "Transcribe (same language)",
    translate: "Translate to English",
    autoDownload: "Automatically download each transcript when it finishes",
    diarize:
      "Separate speakers (experimental — labels each line “Speaker 1”, “Speaker 2”, etc.)",
    keep: "Keep finished transcripts in this browser after a reload",
    keepHint:
      "They stay until you delete them, and anyone using this browser could open them — leave this off on a shared computer. Turning it off deletes the saved copies.",
  },
  saveFailed:
    "This browser refused to save a transcript (a private window, or storage is full or blocked), so it may be missing after a reload. Download anything you want to keep.",
  footer: {
    by: "Vem sa vad? by",
    source: "Source on GitHub",
    basedOn: "Based on",
    byAuthor: "by",
    poweredBy: "Powered by",
    cached: "models download once and cache in your browser.",
  },
  dropzone: {
    drop: "Drop audio or video here",
    dropping: "Drop them! 🎉",
    browse: "or click to browse — pile on as many as you like",
    formats: "transcribed one after another, 100% on your device.",
  },
  recorder: {
    placeholder: "Your voice will appear here as you speak",
    start: "Start recording",
    stop: "Stop recording",
    title: "Record from your microphone",
    recording: "Recording… click to stop and transcribe",
    idle: "Click the mic, speak, then stop to add it to the queue",
    insecure:
      "Microphone needs a secure context (HTTPS or localhost). It isn't available here.",
    denied: "Microphone permission was denied.",
    failed: (detail) => `Couldn't start recording: ${detail}`,
    fileName: "recording",
  },
  podcast: {
    back: "Back",
    loadingEpisodes: "Loading episodes…",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    episodes: (n) => `${n} ${plural(n, "episode", "episodes")}`,
    add: (n) => (n ? `Add ${n} to transcription queue` : "Add to transcription queue"),
    noEpisodes: "No playable episodes found in this feed.",
    placeholder: "Search for a podcast by name…",
    search: "Search",
    intro:
      "Find a show, pick episodes, and they’ll be transcribed locally — the audio is fetched through this site’s own server, never a third party.",
    searchFailed: (detail) => `Search failed: ${detail}`,
    loadFailed: (detail) => `Couldn't load episodes: ${detail}`,
  },
  processing: {
    stage: {
      fetching: "Downloading episode",
      decoding: "Decoding audio",
      transcribing: "Transcribing speech",
      diarizing: "Separating speakers",
    },
    working: "Working",
    ringDownload: "download",
    ringTranscribing: "transcribing",
    ringSpeakers: "speakers",
    downloadingModel: "Downloading model",
    cachedAfter: (pct) => `${pct}% · cached in your browser after the first time`,
    preparing: (device) => `Preparing ${device} runtime`,
    queueProgress: "Queue progress",
    done: (done, total) => `${done} / ${total} done`,
  },
  queue: {
    title: (n) => `Queue · ${n}`,
    deleteFinished: "Delete all finished",
    deleteFinishedTitle: "Deletes all finished transcripts from this list and from this browser",
    askTitle: "Keep finished transcripts if you reload the page?",
    askBefore: "If you say yes, they’re saved in this browser (never uploaded) and ",
    askStay: "stay until you delete them",
    askAfter:
      " — anyone using this browser could open them. If you say no, they disappear when you close or reload the page, so download what you need. You can change this later in Settings.",
    yesKeep: "Yes, keep them",
    noThanks: "No thanks",
    restored: (n) =>
      `Restored ${n} ${plural(n, "transcript", "transcripts")} from your last visit.`,
    keptBefore: "Finished transcripts are ",
    keptStay: "saved in this browser and stay until you delete them",
    keptAfter: " — with ✕ on each one, or ",
    keptDeleteAll: "Delete all finished",
    keptEnd: ". On a shared computer, delete them when you’re done.",
    status: {
      queued: "Queued",
      downloading: (pct) => `Downloading… ${pct}%`,
      decoding: "Decoding",
      transcribing: (pct) => `Transcribing… ${pct}%`,
      diarizing: (pct) => `Separating speakers… ${pct}%`,
      done: "Done",
      failed: "Failed",
    },
    noSpeech: "(no speech detected)",
    show: "Show transcript",
    download: "Download transcript",
    remove: "Remove",
    copy: "Copy",
    copied: "Copied",
    livePreview: "Live preview · the finished transcript may differ slightly",
    nameSpeakers: "Name the speakers",
    namesHint:
      "Names are used in the transcript, Copy and downloads. A file that was downloaded automatically still says “Speaker 1” — download it again after naming.",
  },
  review: {
    onlyUnsure: (n) => `Only unsure lines (${n})`,
    findReplace: "Find & replace",
    detectedTitle: "Auto-detected from the first 30 seconds",
    detected: (name) => `Detected language: ${name}`,
    restored:
      "Restored after a reload · the audio isn’t kept, so lines can’t be played · click text to edit it",
    noPlayback: "Playback isn’t available for this file in the browser.",
    hint: "Click ▶ to hear a line · click text to edit it",
    find: "Find",
    replaceWith: "Replace with",
    matchCase: "Match case",
    wholeWords: "Whole words",
    onlyMatches: "Only lines with matches",
    matches: (m, lines) =>
      `${m} ${plural(m, "match", "matches")} in ${lines} ${plural(lines, "line", "lines")}`,
    alreadyReplaced: (n) => ` · ${n} already as replaced`,
    replaceAll: "Replace all",
    finishEditing: "Finish editing the line first",
    undo: "Undo",
    replaced: (m, lines) =>
      `Replaced ${m} ${plural(m, "match", "matches")} in ${lines} ${plural(lines, "line", "lines")}.`,
    undone: "Undone.",
    undoneKept: (n) =>
      `Undone. ${n} ${plural(n, "line", "lines")} you changed since ${plural(n, "was", "were")} left as is.`,
    noMatches: "No lines match.",
    noUnsure: "No unsure lines left.",
    stop: "Stop",
    play: "Play this line",
    unsureTitle: "The model wasn't sure who said this",
    speaker: "Speaker",
    newSpeaker: "New speaker",
    noSpeaker: "No speaker",
    clickToEdit: "Click to edit",
    removed: "(removed)",
    revert: "Undo my changes to this line",
  },
  export: {
    speaker: (n) => `Speaker ${n}`,
    speakers: "Speakers",
    untitled: "Transcript",
  },
  msg: {
    diarizeTooLong: (p) =>
      `Speaker separation skipped: recording is ${p.minutes} min, longer than the ${p.limit} min limit.`,
    diarizeFailed: (p) => `Speaker separation failed: ${p.detail}`,
    undecodable: () =>
      "This file's audio couldn't be decoded by the browser. Try MP3, WAV, M4A, OGG, FLAC, or an MP4/MOV/WebM video.",
    podcastFetch: (p) =>
      `Couldn't fetch this podcast resource: ${
        p.proxy === "none"
          ? "no proxy is running here"
          : p.proxy === "status"
            ? `the proxy answered HTTP ${p.detail}`
            : `the proxy couldn't be reached (${p.detail})`
      }, and the host doesn't allow direct access. Run \`npm run dev\`, or deploy proxy.php (PHP + cURL) next to the app.`,
    searchHttp: (p) => `Podcast search failed (HTTP ${p.status}).`,
    badFeed: () => "This feed isn't valid RSS/XML.",
    workerCrashed: () => "The transcription worker stopped unexpectedly.",
  },
};

export const STRINGS: Record<Lang, Strings> = { sv, en };

// ── Messages as data ─────────────────────────────────────────────────────────
// A job's warning or error is stored as a key plus parameters rather than as
// finished text, so it shows in whichever language is chosen when it's read —
// also after a reload. Plain strings (an engine error, or text saved before
// this existed) are shown as they are.

type Msgs = Strings["msg"];
export type Message = {
  [K in keyof Msgs]: Parameters<Msgs[K]> extends [infer P] ? { key: K; params: P } : { key: K };
}[keyof Msgs];

export function formatMessage(t: Strings, message: Message | string): string {
  if (typeof message === "string") return message;
  const format = t.msg[message.key] as (params?: unknown) => string;
  return format("params" in message ? message.params : undefined);
}

/** An Error that carries a Message, for code that throws to the UI. */
export class MessageError extends Error {
  readonly msg: Message;
  constructor(msg: Message) {
    super(formatMessage(STRINGS.en, msg));
    this.msg = msg;
  }
}

/** What to keep from a caught error: its Message if it has one, else its text. */
export function messageOf(error: unknown): Message | string {
  if (error instanceof MessageError) return error.msg;
  return String((error as Error)?.message ?? error);
}

// ── React ────────────────────────────────────────────────────────────────────

export const I18nContext = createContext<Strings>(sv);

/** The interface text in the chosen language. */
export function useT(): Strings {
  return useContext(I18nContext);
}

/** A model's name in the interface language: "Whisper Base (English)" → "Whisper Base (engelska)". */
export function modelName(name: string, t: Strings): string {
  return name.replace("(English)", t.settings.englishSuffix);
}

/** "sv" → "svenska" / "Swedish", in the interface language; the code itself if unknown. */
export function languageName(code: string, t: Strings): string {
  try {
    const name = new Intl.DisplayNames([t.locale], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(t.locale) + name.slice(1);
  } catch {
    return code;
  }
}
