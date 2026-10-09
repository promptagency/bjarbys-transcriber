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
    title: "Vem sa vad? — lokal transkribering i webbläsaren",
    description:
      "Lokal transkribering i din webbläsare, med talaruppdelning. Inget laddas upp.",
  },
  uiLanguage: { label: "Språk", sv: "Svenska", en: "English" },
  header: {
    tagline: "Lokal och privat transkribering direkt i webbläsaren.",
    onDevice: "100 % på din enhet",
  },
  phone: {
    title: "Öppna Vem sa vad? på en dator",
    why: "Allt körs i webbläsaren, och att transkribera kräver mer kraft och minne än en mobil har.",
    how: "Öppna sidan i Chrome eller Edge på din dator — skicka länken till dig själv härifrån.",
    share: "Dela länken",
    copied: "Länken är kopierad",
    continue: "Fortsätt ändå på mobilen",
  },
  faq: {
    badge: "Vanliga frågor",
    title: "Vanliga frågor",
    close: "Stäng",
    items: [
      {
        q: "Adressen är vemsavad.promptagency.se. Betyder det att Prompt Agency sparar mina filer?",
        a: [
          "Nej. Adressen talar bara om varifrån själva appen hämtas: sidan, programkoden och ikonerna. Prompt Agency har byggt Vem sa vad? och står för driften, och därför ligger den under promptagency.se.",
          "När sidan har laddats sker allt arbete i din webbläsare, på din egen dator. Ljudet och den färdiga texten skickas aldrig någonstans. Det finns ingen server som tar emot dem, och ingenting sparas hos Prompt Agency eller någon annan.",
          "Det som hämtas över nätet är sidan (via Cloudflare, som levererar den) och, första gången, transkriberingsmodellen (från Hugging Face) och beräkningsmotorn (från jsDelivr). Det som skickas är en anonym besöksräkning (se ”Räknar ni besök?”). Använder du poddfliken skickas också ditt sökord till Apples poddkatalog, som även levererar omslagsbilderna, och poddens flöde och avsnitt hämtas via sidans egen server, eftersom poddar sällan tillåter direkt hämtning. Det är offentligt ljud, och det transkriberas ändå på din dator. Som för alla webbplatser ser de här tjänsterna vanliga anslutningsuppgifter, till exempel din IP-adress, men aldrig dina filer eller din text.",
        ],
      },
      {
        q: "Hur kan jag själv kontrollera att inget laddas upp?",
        a: [
          "Det enklaste testet: transkribera en fil en gång, så att modellen hämtas. Stäng sedan av wifi och nätverk och transkribera igen. Det fungerar lika bra, och utan nätverk kan ingenting skickas.",
          "Sidan har dessutom en säkerhetsregel (Content Security Policy) som hindrar webbläsaren från att kontakta andra adresser än sidan själv, Hugging Face (modellerna), jsDelivr (beräkningsmotorn), Apple (poddsökningen och omslagsbilderna) och Prompt Agencys statistikserver. Källkoden är öppen, så vem som helst kan granska den.",
        ],
        link: { href: "https://github.com/promptagency/vem-sa-vad", label: "Källkoden på GitHub" },
      },
      {
        q: "Räknar ni besök?",
        a: [
          "Ja, anonymt, för att se hur många som använder tjänsten och var de hittar den. När sidan öppnas skickas ett enda meddelande till Prompt Agencys egen statistikserver (Plausible, på en server i Finland inom EU). Det innehåller sidans adress, vilken webbsida du kom ifrån (utan sökord eller andra tillägg i länken) och sidans namn. Servern räknar fram land, webbläsare och typ av enhet ur anslutningen.",
          "Inga cookies sätts och ingenting sparas på din dator. Statistiken sparar inte IP-adressen: den används bara, tillsammans med en nyckel som byts ut varje dygn, för att räkna unika besökare, och kan inte kopplas till dig dagen efter. Ljud, text, filnamn och vad du gör i appen skickas aldrig.",
          "Har du slagit på ”Global Privacy Control” eller ”Do Not Track” i webbläsaren räknas du inte alls. Den som blockerar annonser och spårare räknas oftast inte heller, och det är helt i sin ordning.",
        ],
      },
      {
        q: "Vilka begränsningar har tjänsten?",
        a: ["Vem sa vad? ger ett bra första utkast, inte ett färdigt protokoll. Det här är bra att känna till:"],
        list: [
          "Texten blir inte felfri. Namn, facktermer, dialekter, dåligt ljud och personer som pratar i mun på varandra ger fler fel, och vid långa tysta partier eller musik kan modellen ibland hitta på eller upprepa text. Läs alltid igenom resultatet, och rätta återkommande fel med Sök och ersätt.",
          "Ett språk per fil. Språket gäller hela inspelningen (vid automatisk igenkänning avgör de första 30 sekunderna), så inspelningar som växlar språk blir sämre i det andra språket.",
          "Talaruppdelningen skiljer röster åt men vet inte vem som talar: talarna numreras och du namnger dem själv. Den klarar högst tre röster åt gången, liknande röster eller mycket överlappande tal kan blandas ihop, och inspelningar över fyra timmar delas inte upp.",
          "Långa inspelningar kräver mycket minne, ungefär 230 MB per timme ljud och mer med talaruppdelning. På en dator med lite minne kan riktigt långa filer få fliken att krascha.",
          "Hastigheten beror på datorn. Utan stöd för grafikkortet (WebGPU) körs allt på processorn och går långsammare. Mobiler stöds inte.",
          "Ingen direkttranskribering: möten och samtal spelas in först och transkriberas sedan.",
          "Översättning går bara till engelska.",
          "Filen måste gå att spela upp i webbläsaren. Kopieringsskyddade eller ovanliga format fungerar inte.",
          "Ljudet sparas aldrig, så transkriptioner som du har sparat kan inte spela upp rader efter en omladdning.",
          "Första gången krävs nätverk för att hämta modellen (110 MB–2 GB beroende på modell).",
        ],
      },
      {
        q: "Vad sparas på min dator?",
        a: [
          "Dina inställningar, till exempel språk och filformat, sparas i webbläsaren. Modellerna sparas också där (100 MB–2 GB beroende på modell), så att de bara behöver hämtas en gång. Under Inställningar › Lagring ser du hur mycket plats de tar och kan ta bort dem. När en modell har laddats städas andra versioner av den bort automatiskt, men versionerna för grafikkort och processor sparas båda.",
          "Genomförda transkriptioner sparas bara om du själv har valt det, och ligger då kvar i webbläsaren tills du tar bort dem. Ljudfilerna sparas aldrig. Sidan använder inga cookies, och besöksräkningen sparar ingenting på din dator.",
        ],
      },
      {
        q: "Varför tar det tid första gången?",
        a: [
          "Första gången hämtas transkriberingsmodellen, ungefär 110 MB för standardmodellen. Den sparas sedan i webbläsaren, så nästa gång kommer du igång direkt, även utan nätverk.",
          "En nyare dator med Chrome eller Edge transkriberar ofta flera gånger snabbare än realtid. Låt fliken vara öppen tills det är klart.",
        ],
      },
      {
        q: "Vilken dator och webbläsare behöver jag?",
        a: [
          "En någorlunda ny dator räcker. Chrome eller Edge rekommenderas, eftersom de kan använda datorns grafikkort och då går snabbast. Andra webbläsare fungerar också, men kan vara långsammare.",
          "Mobiler rekommenderas inte: att transkribera kräver mer kraft och minne än en telefon har.",
        ],
      },
      {
        q: "Hur bra är talaruppdelningen?",
        a: [
          "Den är experimentell men fungerar bra på intervjuer och samtal. I vårt test på en verklig intervju med två personer hamnade 95,6 % av orden hos rätt talare.",
          "Den klarar högst tre röster åt gången och inspelningar på upp till fyra timmar. Rader där modellen var osäker markeras, så att du snabbt kan kontrollera dem och byta talare för hand.",
        ],
      },
      {
        q: "Vilka språk fungerar?",
        a: [
          "Svenska fungerar bäst, med KB-Whisper från Kungliga biblioteket. Engelska har en egen modell, och omkring 100 andra språk fungerar med OpenAI:s Whisper. Välj språk i listan eller låt appen känna igen det.",
        ],
      },
      {
        q: "Kostar det något?",
        a: [
          "Nej. Vem sa vad? är gratis och har öppen källkod (MIT-licens). Den bygger på Bjarbys Transcriber av Anders Bjarby och utvecklas av Micke Quick på Prompt Agency.",
        ],
      },
    ] as { q: string; a: string[]; list?: string[]; link?: { href: string; label: string } }[],
  },
  spokenLanguage: "Språk i inspelningen",
  otherLanguages: "Andra språk",
  tabs: { files: "Filer", mic: "Spela in", podcast: "Podd" },
  tabHints: {
    files: "Transkribera ljud- eller videofiler från din dator.",
    mic: "Spela in med mikrofonen och transkribera direkt efteråt.",
    podcast: "Sök upp en podd och transkribera de avsnitt du väljer.",
  },
  model: {
    preDownload: (name: string, size: string) => `Ladda ned ${name} i förväg (${size})`,
    failed: (detail: string) => `Modellen kunde inte laddas: ${detail}`,
  },
  settings: {
    toggle: "Inställningar",
    moreInfo: "Mer information",
    tips: {
      model:
        "Vilken AI-modell som transkriberar. En större modell ger bättre text men tar längre tid att ladda ned och köra. KB-Whisper är tränad på svenska.",
      quality:
        "Hur mycket modellen är komprimerad. Standardvalet är snabbast med nästan samma kvalitet; full kvalitet är större och långsammare.",
      runOn:
        "GPU (grafikkortet) är oftast flera gånger snabbare än CPU (processorn). Automatiskt väljer GPU när datorn klarar det. Välj CPU om något krånglar.",
      formats:
        "Filerna du får när en transkription är klar.\n\nDokument: läsbar text i stycken per talare.\n\nUndertexter (.srt, .vtt): för video.\n\nJSON: text med tider, för program.\n\nFlera format sparas i en .zip.",
      timestamps: "Tiden ([00:09]) före varje stycke, så att du lätt hittar tillbaka i inspelningen.",
      task: "Transkribera skriver ned det som sägs, på samma språk. Översätt skriver i stället texten på engelska.",
      autoDownload:
        "Filerna sparas i mappen för hämtade filer så fort en transkription är klar. Stäng av det om du hellre laddar ned med knappen på varje rad.",
      diarize:
        "Tar reda på vem som pratar när och märker raderna Talare 1, Talare 2 osv. Tar lite extra tid. Du kan namnge talarna efteråt.",
      keep:
        "Genomförda transkriptioner finns kvar om du laddar om sidan eller kommer tillbaka senare, tills du tar bort dem. De sparas bara i den här webbläsaren, aldrig på någon server, men alla som använder webbläsaren kan öppna dem: låt det vara av på en delad dator. Stänger du av det raderas de sparade kopiorna.",
    },
    heading: "Finjustera",
    applyReload: "Använd och ladda om modellen",
    model: "Modell",
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
    auto: (device: string) => `Automatiskt (${device})`,
    gpu: (available: boolean) => `GPU — WebGPU${available ? "" : " (inte tillgängligt)"}`,
    cpu: "CPU — WASM",
    formats: "Filformat",
    format: {
      txt: "Dokument (.txt)",
      md: "Dokument (.md)",
      srt: "Undertexter (.srt)",
      vtt: "WebVTT (.vtt)",
      json: "JSON (.json)",
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
    keep: "Spara genomförda transkriptioner i den här webbläsaren efter en omladdning",
  },
  storage: {
    title: "Lagring",
    tip: "Modellerna sparas i webbläsaren så att de bara behöver laddas ned en gång. Här ser du hur mycket plats de tar och kan ta bort dem; en borttagen modell laddas ned igen när den behövs. Inställningar och sparade transkriptioner påverkas inte.",
    total: (size: string) => `Totalt ${size}`,
    inUse: "används",
    speakers: "Talaruppdelning",
    runtime: "Beräkningsmotor",
    remove: "Ta bort",
    removeOne: (name: string) => `Ta bort ${name}`,
    removeAll: "Ta bort alla",
    confirmAll: "Ja, ta bort alla",
    cancel: "Avbryt",
    busy: "Går inte medan en modell laddas eller en transkribering pågår.",
    offline: "Du är offline – det du tar bort kan inte laddas ned igen förrän du är uppkopplad.",
    failed: "Det gick inte att ta bort allt – webbläsaren nekade. Listan visar vad som finns kvar.",
    empty: "Inga modeller är nedladdade ännu.",
    unavailable: "Webbläsaren låter inte sidan läsa sin lagring här.",
  },
  saveFailed:
    "Webbläsaren vägrade spara en transkription (ett privat fönster, eller lagringen är full eller blockerad), så den kan saknas efter en omladdning. Ladda ned det du vill behålla.",
  footer: {
    by: "av",
    source: "Källkod på GitHub",
    basedOn: "Bygger på",
    byAuthor: "av",
    poweredBy: "Drivs av",
  },
  dropzone: {
    drop: "Släpp ljud eller video här",
    dropping: "Släpp dem! 🎉",
    browse: "eller klicka för att välja — lägg till så många du vill",
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
    slowServer:
      "Servern är långsam just nu – nedladdningen fortsätter. Första gången en modell hämtas kan det ta en stund.",
    preparing: (device: string) => `Förbereder körning på ${device}`,
    queueProgress: "Förlopp i kön",
    done: (done: number, total: number) => `${done} av ${total} klara`,
  },
  queue: {
    title: (n: number) => `Kö · ${n}`,
    deleteFinished: "Ta bort alla genomförda",
    deleteFinishedTitle: "Tar bort alla genomförda transkriptioner från listan och från webbläsaren",
    askTitle: "Spara genomförda transkriptioner om du laddar om sidan?",
    askBefore: "Säger du ja sparas de i den här webbläsaren (aldrig uppladdade) och ",
    askStay: "ligger kvar tills du tar bort dem",
    askAfter:
      " — alla som använder webbläsaren kan öppna dem. Säger du nej försvinner de när du stänger eller laddar om sidan, så ladda ned det du behöver. Du kan ändra det senare under Inställningar.",
    yesKeep: "Ja, spara dem",
    noThanks: "Nej tack",
    restored: (n: number) =>
      `Återställde ${n} ${plural(n, "transkription", "transkriptioner")} från ditt förra besök.`,
    keptBefore: "Genomförda transkriptioner ",
    keptStay: "sparas i den här webbläsaren och ligger kvar tills du tar bort dem",
    keptAfter: " — med ✕ på var och en, eller ",
    keptDeleteAll: "Ta bort alla genomförda",
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
    title: "Vem sa vad? — local transcription in your browser",
    description:
      "Local transcription in your browser, with speaker separation. Nothing is uploaded.",
  },
  uiLanguage: { label: "Language", sv: "Svenska", en: "English" },
  header: {
    tagline: "Local and private transcription, right in your browser.",
    onDevice: "100% on your device",
  },
  phone: {
    title: "Open Vem sa vad? on a computer",
    why: "Everything runs in the browser, and transcribing takes more power and memory than a phone has.",
    how: "Open this page in Chrome or Edge on your computer — send yourself the link from here.",
    share: "Share the link",
    copied: "Link copied",
    continue: "Continue on this phone anyway",
  },
  faq: {
    badge: "FAQ",
    title: "Frequently asked questions",
    close: "Close",
    items: [
      {
        q: "The address is vemsavad.promptagency.se. Does that mean Prompt Agency stores my files?",
        a: [
          "No. The address only says where the app itself is loaded from: the page, its code and its icons. Prompt Agency built Vem sa vad? and runs it, which is why it lives under promptagency.se.",
          "Once the page has loaded, all the work happens in your browser, on your own computer. The audio and the finished text are never sent anywhere. There is no server that receives them, and nothing is stored by Prompt Agency or anyone else.",
          "What is fetched over the network is the page (via Cloudflare, which delivers it) and, the first time, the transcription model (from Hugging Face) and the compute engine (from jsDelivr). What is sent is an anonymous visit count (see “Do you count visits?”). If you use the Podcast tab, your search term is also sent to Apple’s podcast directory, which also supplies the cover images, and the podcast’s feed and episodes are fetched through the site’s own server, because podcast hosts rarely allow direct downloads. That is public audio, and it is still transcribed on your computer. As with any website, these services see ordinary connection details such as your IP address, but never your files or your text.",
        ],
      },
      {
        q: "How can I check for myself that nothing is uploaded?",
        a: [
          "The simplest test: transcribe a file once, so the model is downloaded. Then turn off Wi-Fi and the network and transcribe again. It works just as well, and with no network nothing can be sent.",
          "The page also carries a security rule (a Content Security Policy) that stops the browser from contacting any address other than the page itself, Hugging Face (the models), jsDelivr (the compute engine), Apple (podcast search and cover images) and Prompt Agency’s statistics server. The source code is open, so anyone can review it.",
        ],
        link: { href: "https://github.com/promptagency/vem-sa-vad", label: "Source code on GitHub" },
      },
      {
        q: "Do you count visits?",
        a: [
          "Yes, anonymously, to see how many people use the service and where they find it. When the page opens, a single message is sent to Prompt Agency’s own statistics server (Plausible, on a server in Finland, in the EU). It contains the page address, the web page you came from (without search terms or other additions to the link), and the site’s name. The server works out country, browser and device type from the connection.",
          "No cookies are set and nothing is stored on your computer. The statistics don’t store the IP address: it is only used, together with a key that changes every day, to count unique visitors, and cannot be linked to you the next day. Audio, text, file names and what you do in the app are never sent.",
          "If you have turned on “Global Privacy Control” or “Do Not Track” in your browser, you are not counted at all. Ad and tracker blockers usually stop the count too, and that’s perfectly fine.",
        ],
      },
      {
        q: "What are the limitations?",
        a: ["Vem sa vad? gives you a good first draft, not a finished record. Worth knowing:"],
        list: [
          "The text won’t be flawless. Names, jargon, dialects, poor audio and people talking over each other cause more errors, and during long silences or music the model can occasionally invent or repeat text. Always read the result through, and fix recurring errors with Find & replace.",
          "One language per file. The language applies to the whole recording (with auto-detect, the first 30 seconds decide), so recordings that switch language come out worse in the second one.",
          "Speaker separation tells voices apart but doesn’t know who is speaking: speakers are numbered and you name them yourself. It handles at most three voices at a time, similar voices or heavily overlapping speech can be mixed up, and recordings over four hours aren’t separated.",
          "Long recordings need a lot of memory, about 230 MB per hour of audio and more with speaker separation. On a computer with little memory, very long files can make the tab crash.",
          "Speed depends on the computer. Without graphics card support (WebGPU) everything runs on the processor and is slower. Phones are not supported.",
          "No live transcription: meetings and calls are recorded first and transcribed afterwards.",
          "Translation is to English only.",
          "The file must be playable in the browser. Copy-protected or unusual formats don’t work.",
          "Audio is never stored, so transcripts you have kept can’t play lines after a reload.",
          "The first time, a network connection is needed to download the model (110 MB–2 GB depending on the model).",
        ],
      },
      {
        q: "What is stored on my computer?",
        a: [
          "Your settings, such as language and file formats, are stored in the browser. So are the models (100 MB–2 GB depending on the model), so they only need to be downloaded once. Under Settings › Storage you can see how much space they take and remove them. Once a model has loaded, other versions of it are cleaned up automatically, but the versions for the graphics card and the processor are both kept.",
          "Finished transcripts are only kept if you choose to, and then stay in the browser until you delete them. Audio files are never stored. The site uses no cookies, and the visit count stores nothing on your computer.",
        ],
      },
      {
        q: "Why does it take a while the first time?",
        a: [
          "The first time, the transcription model is downloaded: about 110 MB for the default model. It is then kept in the browser, so next time you can start right away, even without a network.",
          "A recent computer with Chrome or Edge often transcribes several times faster than real time. Keep the tab open until it is done.",
        ],
      },
      {
        q: "What computer and browser do I need?",
        a: [
          "A reasonably recent computer is enough. Chrome or Edge is recommended, as they can use the computer’s graphics card and are fastest. Other browsers work too, but can be slower.",
          "Phones are not recommended: transcribing takes more power and memory than a phone has.",
        ],
      },
      {
        q: "How good is the speaker separation?",
        a: [
          "It is experimental but works well on interviews and conversations. In our test on a real two-person interview, 95.6% of the words were attributed to the right speaker.",
          "It handles at most three voices at a time and recordings of up to four hours. Lines where the model was unsure are marked, so you can check them quickly and change the speaker by hand.",
        ],
      },
      {
        q: "Which languages work?",
        a: [
          "Swedish works best, with KB-Whisper from the National Library of Sweden. English has its own model, and about 100 other languages work with OpenAI’s Whisper. Pick the language in the list or let the app recognise it.",
        ],
      },
      {
        q: "Does it cost anything?",
        a: [
          "No. Vem sa vad? is free and open source (MIT licence). It is based on Bjarbys Transcriber by Anders Bjarby and developed by Micke Quick at Prompt Agency.",
        ],
      },
    ],
  },
  spokenLanguage: "Language spoken",
  otherLanguages: "Other languages",
  tabs: { files: "Files", mic: "Record", podcast: "Podcast" },
  tabHints: {
    files: "Transcribe audio or video files from your computer.",
    mic: "Record with your microphone and transcribe it straight after.",
    podcast: "Find a podcast and transcribe the episodes you pick.",
  },
  model: {
    preDownload: (name, size) => `Pre-download ${name} (${size})`,
    failed: (detail) => `The model couldn't be loaded: ${detail}`,
  },
  settings: {
    toggle: "Settings",
    moreInfo: "More information",
    tips: {
      model:
        "The AI model that transcribes. A larger model gives better text but takes longer to download and run. KB-Whisper is trained on Swedish.",
      quality:
        "How much the model is compressed. The default is fastest with almost the same quality; full quality is larger and slower.",
      runOn:
        "The GPU (graphics card) is usually several times faster than the CPU (processor). Auto picks the GPU when the computer supports it. Choose CPU if something goes wrong.",
      formats:
        "The files you get when a transcript is done.\n\nDocument: readable text in paragraphs per speaker.\n\nSubtitles (.srt, .vtt): for video.\n\nJSON: text with times, for software.\n\nSeveral formats are saved as one .zip.",
      timestamps: "The time ([00:09]) before each paragraph, so you can easily find your way back in the recording.",
      task: "Transcribe writes down what is said, in the same language. Translate writes the text in English instead.",
      autoDownload:
        "The files are saved to your downloads folder as soon as a transcript is done. Turn it off if you’d rather download with the button on each row.",
      diarize:
        "Works out who speaks when and labels the lines Speaker 1, Speaker 2 and so on. Takes a little extra time. You can name the speakers afterwards.",
      keep:
        "Finished transcripts stay if you reload the page or come back later, until you delete them. They’re kept only in this browser, never on a server, but anyone using this browser can open them: leave this off on a shared computer. Turning it off deletes the saved copies.",
    },
    heading: "Fine-tune",
    applyReload: "Apply & reload model",
    model: "Model",
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
    auto: (device) => `Auto (${device})`,
    gpu: (available) => `GPU — WebGPU${available ? "" : " (not available)"}`,
    cpu: "CPU — WASM",
    formats: "Output formats",
    format: {
      txt: "Document (.txt)",
      md: "Document (.md)",
      srt: "Subtitles (.srt)",
      vtt: "WebVTT (.vtt)",
      json: "JSON (.json)",
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
  },
  storage: {
    title: "Storage",
    tip: "Models are kept in the browser so they only need to be downloaded once. Here you can see how much space they take and remove them; a removed model is downloaded again when it’s needed. Settings and saved transcripts are not affected.",
    total: (size) => `${size} in total`,
    inUse: "in use",
    speakers: "Speaker separation",
    runtime: "Compute engine",
    remove: "Remove",
    removeOne: (name) => `Remove ${name}`,
    removeAll: "Remove all",
    confirmAll: "Yes, remove all",
    cancel: "Cancel",
    busy: "Not possible while a model is loading or a transcription is running.",
    offline: "You’re offline – anything you remove can’t be downloaded again until you’re back online.",
    failed: "Not everything could be removed – the browser refused. The list shows what’s left.",
    empty: "No models have been downloaded yet.",
    unavailable: "This browser doesn’t let the page read its storage here.",
  },
  saveFailed:
    "This browser refused to save a transcript (a private window, or storage is full or blocked), so it may be missing after a reload. Download anything you want to keep.",
  footer: {
    by: "by",
    source: "Source on GitHub",
    basedOn: "Based on",
    byAuthor: "by",
    poweredBy: "Powered by",
  },
  dropzone: {
    drop: "Drop audio or video here",
    dropping: "Drop them! 🎉",
    browse: "or click to browse — pile on as many as you like",
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
    slowServer:
      "The server is slow right now – the download continues. The first download of a model can take a while.",
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
  // A transcript saved by an older version may carry a key that no longer
  // exists; show the key rather than fail to render the whole queue.
  const format = t.msg[message.key] as ((params?: unknown) => string) | undefined;
  if (typeof format !== "function") return String(message.key);
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
