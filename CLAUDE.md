# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Vem sa vad?** — private, in-browser audio/video transcription with speaker separation. A fork of
[fltman/bjarbys-transcriber](https://github.com/fltman/bjarbys-transcriber) by Anders Bjarby (MIT).
Everything runs in the user's browser; there is no backend except the optional podcast proxy.
Vite 7 + React 19 + TypeScript + Tailwind 4, built as a static site (`base: './'`, so it works from any subfolder).

## Commands

```bash
npm install
npm run dev         # http://localhost:5173 — includes a dev stand-in for proxy.php
npm run typecheck   # tsc -b --noEmit
npm run build       # tsc -b && vite build → dist/
npm run preview     # serves dist/ — has NO podcast proxy, so podcasts mostly fail here
```

There is no test runner and no linter. Verify changes with `npm run typecheck` / `npm run build`, and in the
browser for anything touching transcription (Chrome/Edge for WebGPU).

Transcription speed and word error rate are measured in the browser with `bench.html` (dev server only) on a
recording from `scripts/make-bench-audio.sh` — see `docs/benchmark.md`, and add a row there when a change is
meant to make things faster or more accurate. Keep the tab visible while it runs.

Speaker-separation accuracy is measured with scripts that run the shipping `src/lib/diarize.ts` under Node:

```bash
node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
node --experimental-strip-types scripts/eval-word-timestamps.mjs <fixture-dir> [asrModel]   # slow: two ASR passes
```

The fixture (`excerpt.wav` + `labels.csv`/`labels_TOFILL.csv`) lives **outside the repo** and is confidential
client audio: never copy it into the repo, and don't quote its transcript in commits, PRs or READMEs. Figures
quoted in the README and `docs/speaker-separation.md` (e.g. 95.6% word accuracy) come from
`eval-diarization.mjs`; re-run it and update both (and the FAQ) when diarization logic or scoring changes.

## Architecture

**Main thread ↔ worker.** All model work happens in one module Web Worker (`src/worker.ts`). The message
contract is `ToWorker`/`FromWorker` in `src/lib/protocol.ts`; `src/hooks/useWhisper.ts` turns it into
promises keyed by `jobId` (`loadModel`, `transcribe`, `diarize`). If the worker dies, every pending promise is
rejected so the queue can't hang.

**Job queue (`src/App.tsx` + `src/lib/jobs.ts`).** Files, mic recordings and podcast episodes all become
`Job`s with a lazy `getAudio()`. A single `drain()` loop runs one job at a time through
`fetching` (podcasts) → `decoding` → `transcribing` → `diarizing` (optional). Audio is decoded to mono 16 kHz
PCM on the main thread (`src/lib/audio.ts`, Web Audio) and **transferred** to the worker. When speaker
separation will follow, `transcribe` is sent with `retainAudio`, and the worker keeps that buffer for the
next `diarize` message instead of the page sending a second copy (~230 MB per hour of audio).
Whisper hears 30 s windows overlapping by 2.5 s per side (`STRIDE_LENGTH_S`): the library default of 5 s repeated
whole sentences at the seams and 0–1 s dropped words (docs/benchmark.md) — re-run the benchmark before changing it.
`job.willDiarize` is fixed when the job starts, so toggling the setting mid-job can't skew progress.
While transcribing, the worker posts `transcribe-partial` (finished windows merged with `_decode_asr`, as the
final result is, plus the window in progress) into `job.liveText`, shown by `LivePreview` in `JobQueue` and
never saved. Window token sequences come from wrapping `pipe.model.generate` for the duration of one file —
the streamer's `on_finalize` is *not* a window boundary, since Whisper's seek loop may decode a window in
several passes. Only the last 40 windows are re-merged and the last 20k characters sent, so long files stay cheap. Each job keeps its original media (`getMedia()` → `job.media`; decoding happens in `runJob`) so the review view
(`src/components/TranscriptReview.tsx`) can play single lines, and keeps `originalResult` so edited lines can be
reverted. Manual edits rewrite `job.result` (and rebuild its flat `text`), so every export sees them; find & replace
(`src/lib/replace.ts`) changes many lines in one `onReplaceChunks` update, which its single-level Undo also uses.
The word list (`settings.glossary`, one term per line) feeds `src/lib/glossary.ts`, which finds word sequences in
the finished lines that *sound* like a term (a coarse sound key + bounded edit distance, threshold 0.85, an edge
word only counts if it improves the match) and the review view offers them as suggestions — accepted per group or
all at once through the same `onReplaceChunks` and Undo, never applied automatically. Feeding the list to Whisper
as a prompt was measured and rejected (small gains, some words worse). The list is edited in `GlossaryDialog`
(opened from Settings and the review panel; search, paste many, import/export `.txt`), and corrections offer new
names for it (`newTermsIn` after a hand edit, the replacement after Find & replace) — only on a click.

**Language detection (`detectLanguage` in the worker).** Transformers.js does not detect language — with
none given it forces English — so when the language is on auto-detect the worker scores Whisper's language
tokens after `<|startoftranscript|>` on the first 30 s and transcribes with the winner (one language per file),
stored as `result.language`. English-only models take neither language nor task.

**Models (`src/lib/models.ts`, `resolveDtype` in the worker).** Whisper via Transformers.js, downloaded from
the Hugging Face CDN and cached by the browser. Each model lists quantization tiers; `availableTiers()` hides
combinations that break on a backend. The "Balanced (GPU)" tier (`q4f16` in settings) loads an **fp16 encoder +
q4f16 decoder**, or fp32 encoder + q4 decoder when the GPU lacks `shader-f16` (`resolveDtype`). Don't put the
encoder at 4 bits: it measured fine on Swedish but dropped speech after a language switch. 16-bit on WebGPU
needs transformers.js 4.x (3.x produced garbage). 8-bit decoders are CPU-only (~10× slower on WebGPU).
Measurements: `docs/webgpu-quantization.md`. Transformers.js pins *development* builds of `onnxruntime-web`;
`package.json` `overrides` forces the latest stable release instead — when upgrading Transformers.js, move
the override to the stable ONNX Runtime closest to what it pins, and re-test GPU, CPU and speaker separation. A load is tried twice with the requested dtype before any fallback (fp32+q4 on the GPU, then WASM with a
CPU-safe dtype): first-attempt failures were seen only intermittently and never reproduced under
instrumentation. First downloads can be slow because Hugging Face's CDN serves cold files slowly (verified);
after 10 s without progress the loading panel says the server is slow.

**Speaker separation (`src/lib/diarize.ts`).** pyannote segmentation-3.0 (ONNX, ~1.5 MB, loaded lazily on
WASM) emits a *powerset* over 3 local speakers — `decodeActivity` turns it into per-speaker spans where
silence and overlap are not extra speakers. Long audio is split into 25-min windows overlapping by 2 min
(`planWindows`), speakers are matched across seams (`stitchWindows`), and on out-of-memory the worker
halves the window and retries. `assignSpeakers` gives each Whisper chunk to whoever talks longest across
it (`speaker_conf` = margin to the runner-up) — except a line under 1.5 s with a clearly active second voice,
which goes to the speaker whose speech is most contained in it (backchannels over someone else's turn), `smoothSpeakers` folds short low-confidence runs into their
surroundings and renumbers speakers by first appearance. Hard limits: 3 speakers at once, 240 min per file.
`docs/word-timestamps.md` documents why word-level timestamps were measured and rejected — don't reintroduce them.

**Downloaded models (`src/lib/modelStorage.ts`, `ModelStorage` in Settings).** Transformers.js keeps models
and the ONNX runtime in Cache Storage (`transformers-cache`), keyed by their Hugging Face / jsDelivr URLs, each
with a `content-length`. Settings › Lagring lists them per model with sizes and removes one or all (locked while
a model loads or a job runs; never touches settings or IndexedDB). After a load that used the dtype first asked
for, the worker prunes the model's other quantizations — keeping both the loaded set and the other backend's
default (GPU fp16/q4f16 and fp32/q4, or CPU q8), since "Auto" can switch backends — and other ONNX runtime
versions (`pruneAfterLoad`), then posts `storage-changed`; after a fallback it prunes nothing. The worker sets
`env.cacheKey` to `MODEL_CACHE` itself (so a changed Transformers.js default can't split the two) and prunes only
when files really go to that Cache Storage. Removals and prunes are announced on a `BroadcastChannel`, so every
open tab's list stays current; a tab that loads while another removes simply downloads again.

**Visit counting (`src/lib/analytics.ts`).** `countVisit()` in `main.tsx` POSTs one page view to Prompt
Agency's Plausible (`plausible.app.promptagency.se`, allowed in the CSP's `connect-src`) — our own code, not
Plausible's script, so no outside code runs on the page. Only on `vemsavad.promptagency.se`; skipped for
GPC/Do Not Track, automated browsers and browsers flagged with `?plausible_ignore=true` (localStorage, as in
Plausible's own script); only `utm_*` query parameters are kept. Never send audio, text, file
names or in-app actions, and keep the FAQ's "Räknar ni besök?" in step with any change.

**FAQ (`src/components/Faq.tsx`, text in i18n's `faq`).** A badge beside "100 % på din enhet" opens a native
`<dialog>`. Its answers make factual promises — what leaves the computer (the page via Cloudflare, models from
Hugging Face, the runtime from jsDelivr, podcast search terms and cover art to/from Apple, feeds and episodes via
the proxy, the visit count), what's stored, the 95.6% speaker figure, the
limits — so update it whenever those change.

**Phones (`src/lib/device.ts`, `PhoneNotice`).** `main.tsx` shows phones a "use a computer" page instead of
the app (the worker never starts); "continue anyway" is remembered for the session. Detection uses
`userAgentData.mobile` or the UA's phone markers, never screen width, so tablets and narrow desktop windows get
the app.

**Interface language (`src/lib/i18n.ts`).** All UI text lives in one dictionary: Swedish (`sv`, the default
and the master) and English (`en: Strings`, so a missing key fails the build); no i18n library. App picks
`STRINGS[settings.uiLanguage]`, provides it via `I18nContext`, and components read it with `useT()`. New UI
text goes into both languages, never inline. Text that is stored and shown later — job warnings/errors — is a
`Message` (key + params, rendered by `formatMessage`), and libs throw `MessageError`, so it follows a language
switch and survives in IndexedDB; plain strings (engine errors, older saves) still render as-is. Component
state messages are kept as `(t) => string` for the same reason. Exports take `t.export` as `ExportLabels`
("Talare 1"). English labels left in libs (`DTYPE_LABEL`, `LANGUAGES`, `EXPORT_FORMATS`) serve only the
English-only `bench.html`.

**Exports (`src/lib/exporters.ts`, `src/lib/zip.ts`).** All formats are rendered from the one
stored `TranscriptResult`; lines get a speaker prefix when chunks carry speakers — the user's name from
`job.speakerNames` (per job, edited in `JobQueue`) or `t.export.speaker(n)` ("Talare N" / "Speaker N", following
the interface language) — and JSON's `text` is built from `toTxt()`
so all formats agree. JSON keeps numeric `speaker` per chunk plus a `speakers` id→name map. The document
formats (`txt`, the default, and `md`) go through `toDocument()`; Copy uses `toTxt()`, one fragment per line
(no longer a download format). Old saved settings: `doc` maps to `txt`, and a saved `lines` drops out. Documents: chunks merge into paragraphs per speaker
turn, split at gaps ≥ `PARAGRAPH_PAUSE_SECONDS`; Markdown text is escaped (including list-like paragraph
starts), the header date is local, and the title/timestamp option come from `downloadJob`. Several formats are saved as one store-only ZIP because browsers
silently block bursts of downloads.

**Podcasts (`src/lib/podcasts.ts`).** iTunes Search API (CORS-enabled) to find shows; RSS and audio are
fetched directly and fall back to the same-origin `public/proxy.php` (PHP + cURL, basic SSRF guard). In dev,
the `devPodcastProxy` plugin in `vite.config.ts` serves `/proxy.php` (`apply: 'serve'`, so not in preview).

**Deployment.** Public site: Cloudflare Pages (`wrangler.toml`), deployed from `main`, custom domain
`vemsavad.promptagency.se` (CNAME at Loopia → the `pages.dev` address). `public/_headers` sets COOP/COEP and a
strict CSP — any new outside host the app talks to must be added there or it is blocked; podcasts therefore go
through the proxy first. `functions/proxy.php.ts` is the Pages version of `proxy.php` (same-origin callers,
feeds/media only). `public/sw.js` precaches the app on install for offline use; it only touches same-origin
files and is registered in production builds only. Check locally with `npx wrangler pages dev dist`.
Pages rejects files over 25 MiB, so `vite.config.ts` drops the unused ONNX Runtime `.wasm` copy Vite would
emit (Transformers.js loads the runtime from jsDelivr, which the CSP allows).
Self-hosting on Apache still works: `public/.htaccess` forces HTTPS and adds an SPA fallback.

**Persistence (`src/lib/storage.ts`).** Keeping transcripts is **opt-in** (`settings.keepTranscripts`, off by
default; a one-time card in `JobQueue` asks when the first job finishes, tracked by `keepTranscriptsAsked`).
When on, finished jobs (result, `originalResult`, `speakerNames`, label…) are saved to IndexedDB and restored on load as `restored` jobs via `jobFromSaved()`; media is never stored, so
restored jobs can't play lines. Settings live in `localStorage` and pass through `restoreSettings()`, which
falls back to defaults field by field. In `App.tsx`, a throttled save pass (≤ once per 400 ms — not a debounce,
because progress ticks change `jobs` constantly) writes changed jobs and deletes ones that left the list; it
also flushes on `visibilitychange`/`pagehide`. Writes resolve on transaction commit; storage failures are
silent except for an on-page note. Queued/running jobs aren't saved — without their files they can't resume.
Turning keeping off (or loading with it off) deletes every stored transcript. Settings are always saved.

**Colours (`src/index.css` `@theme`).** Matched to the logo and Prompt Agency's brand: neutral near-black and
greys (`neutral-*`, no blue-tinted `slate`), **sienna** (`brand-*`, #C85A3E) for actions, focus and progress,
**mint** (`mint-*`) for "done/ready" and, solid with `ink` text like the logo's bubbles, the privacy badge; **lavender** (`lavender-*`), solid, for the FAQ badge. Red
for errors and amber for unsure lines stay. Use these tokens rather than Tailwind's sky/cyan/emerald/violet.

## Repository conventions

- `origin` = `promptagency/vem-sa-vad` (the fork). **Every feature is developed on its own branch**
  (`feature/<name>`), with commits that touch only that feature, and lands on `main` through a PR in this fork.
  Keeping features apart means any one of them can be offered upstream without untangling it from others.
  Small fixes (docs, typos, an isolated bug fix) may go straight to `main`.
- **Before a feature branch is merged** (into `main`, or offered upstream), always:
  1. **Test edge cases in the browser**, not just the happy path: the feature with speaker separation on *and*
     off, several jobs in the queue (state must not leak between them), empty/cleared input, odd characters
     (`Åsa "Q" <b>&` must render as text), collapse/reopen, every export format including the multi-format zip,
     and the long-recording/windowed path when the feature touches diarization.
  2. **Run `/code-review` on the branch** and fix what it finds — or say why a finding doesn't hold.
  3. **List what was tested, the review findings and what's left untested** in the fork PR.
  Testing techniques that work here: generate a two-voice test file with macOS `say` (Swedish voice `Alva` plus
  an English voice) and serve it from a temporary `public/test-audio/` (delete it afterwards); switch off
  auto-download; capture downloads in the page by wrapping `URL.createObjectURL` and
  `HTMLAnchorElement.prototype.click`, and Copy via `Object.defineProperty(navigator.clipboard, 'writeText', …)`,
  so nothing lands in the user's Downloads or clipboard. The page can stop responding while Whisper runs; wait
  for the job to finish before driving the UI.
  **The test tab must be visible** (`document.visibilityState === "visible"` — ask the user to bring Chrome to
  the front): a hidden tab never loads `<audio>` media and throttles `setTimeout` to about once a minute, which
  looks like a frozen page. In a hidden tab, yield with `MessageChannel` instead of timers. To get "unsure"
  lines, mix two `say` voices that **overlap** in time with ffmpeg `adelay` + `amix`; clean alternating turns
  are never unsure. The labelled eval interview is confidential client audio — never copy it into the repo or
  `public/`, even temporarily.
- PRs to upstream carry **one feature each**, built on upstream's `main`. A feature that depends on another
  open upstream PR either waits for it to merge or is based on that PR's branch and says so.
- `upstream` = `fltman/bjarbys-transcriber` (Anders's repo, read-only). Never push there; anything public on it
  (issues, PRs, comments) needs the owner's explicit go-ahead. PR #1 there offers speaker separation from the
  `speaker-separation` branch, which was rebuilt by hand from upstream `main` — so syncing upstream into this
  fork needs care (`git merge -s ours` only if upstream equals the merged PR exactly).
- Keep Anders Bjarby's credit visible (README intro, app footer, `LICENSE`) — MIT requires the notice.
- The README is for users first, then self-hosters and developers: features, privacy, getting started and
  short summaries. Technical detail goes in `docs/` (`hosting.md`, `speaker-separation.md`,
  `architecture.md`, `benchmark.md`, …), linked from the README.
- Parked work lives on branches: `feature/pianissimo` (Klang AI's Pianissimo model, WebGPU-only, self-hosted
  765 MB), `spike/pianissimo` (its benchmark harness and findings) and `spike/multi-speaker` (more than 3
  speakers: segmentation windows + WeSpeaker fingerprints + clustering; no gain on a labelled 4-speaker
  recording because the fingerprints couldn't tell two similar voices apart — a stronger voice model is the
  next thing to try, measured with `src/spike/eval-multi.mjs`).
