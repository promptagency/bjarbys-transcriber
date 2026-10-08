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
quoted in the README (e.g. 95.6% word accuracy) come from `eval-diarization.mjs`; re-run it and update the
README when diarization logic or scoring changes.

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
the override to the stable ONNX Runtime closest to what it pins, and re-test GPU, CPU and speaker separation. A failed WebGPU load falls back to WASM with a CPU-safe dtype.

**Speaker separation (`src/lib/diarize.ts`).** pyannote segmentation-3.0 (ONNX, ~1.5 MB, loaded lazily on
WASM) emits a *powerset* over 3 local speakers — `decodeActivity` turns it into per-speaker spans where
silence and overlap are not extra speakers. Long audio is split into 25-min windows overlapping by 2 min
(`planWindows`), speakers are matched across seams (`stitchWindows`), and on out-of-memory the worker
halves the window and retries. `assignSpeakers` gives each Whisper chunk to whoever talks longest across
it (`speaker_conf` = margin to the runner-up) — except a line under 1.5 s with a clearly active second voice,
which goes to the speaker whose speech is most contained in it (backchannels over someone else's turn), `smoothSpeakers` folds short low-confidence runs into their
surroundings and renumbers speakers by first appearance. Hard limits: 3 speakers at once, 240 min per file.
The README documents why word-level timestamps were measured and rejected — don't reintroduce them.

**Exports (`src/lib/exporters.ts`, `src/lib/zip.ts`).** All formats are rendered from the one
stored `TranscriptResult`; lines get a speaker prefix when chunks carry speakers — the user's name from
`job.speakerNames` (per job, edited in `JobQueue`) or `Speaker N` — and JSON's `text` is built from `toTxt()`
so all formats agree. JSON keeps numeric `speaker` per chunk plus a `speakers` id→name map. The document
formats (`txt`, the default, and `md`) go through `toDocument()`; `lines` (→ `.lines.txt`) and Copy use
`toTxt()`, one fragment per line. Old saved settings: `doc` maps to `txt`, and a `txt` saved next to `doc` maps to `lines`; a lone saved `txt`
deliberately becomes the document. Documents: chunks merge into paragraphs per speaker
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
- Parked work lives on branches: `feature/pianissimo` (Klang AI's Pianissimo model, WebGPU-only, self-hosted
  765 MB) and `spike/pianissimo` (its benchmark harness and findings).
