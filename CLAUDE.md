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

Speaker-separation accuracy is measured with scripts that run the shipping `src/lib/diarize.ts` under Node:

```bash
node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
node --experimental-strip-types scripts/eval-word-timestamps.mjs <fixture-dir> [asrModel]   # slow: two ASR passes
```

The fixture (`excerpt.wav` + `labels.csv`/`labels_TOFILL.csv`) lives **outside the repo** and is confidential
client audio: never copy it into the repo, and don't quote its transcript in commits, PRs or READMEs. Figures
quoted in the README (e.g. 94.7% word accuracy) come from `eval-diarization.mjs`; re-run it and update the
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
`job.willDiarize` is fixed when the job starts, so toggling the setting mid-job can't skew progress.
Each job keeps its original media (`getMedia()` → `job.media`; decoding happens in `runJob`) so the review view
(`src/components/TranscriptReview.tsx`) can play single lines, and keeps `originalResult` so edited lines can be
reverted. Manual edits rewrite `job.result` (and rebuild its flat `text`), so every export sees them.

**Models (`src/lib/models.ts`, `resolveDtype` in the worker).** Whisper via Transformers.js, downloaded from
the Hugging Face CDN and cached by the browser. Each model lists quantization tiers; `availableTiers()` hides
combinations that break on a backend. On **WebGPU the encoder must stay fp32** (quantized encoders make
base+ models emit one token and stop) — the "Balanced (GPU)" tier is fp32 encoder + q4 decoder. 8-bit
decoders are CPU-only. A failed WebGPU load falls back to WASM with a CPU-safe dtype.

**Speaker separation (`src/lib/diarize.ts`).** pyannote segmentation-3.0 (ONNX, ~1.5 MB, loaded lazily on
WASM) emits a *powerset* over 3 local speakers — `decodeActivity` turns it into per-speaker spans where
silence and overlap are not extra speakers. Long audio is split into 25-min windows overlapping by 2 min
(`planWindows`), speakers are matched across seams (`stitchWindows`), and on out-of-memory the worker
halves the window and retries. `assignSpeakers` gives each Whisper chunk to whoever talks longest across
it (`speaker_conf` = margin to the runner-up), `smoothSpeakers` folds short low-confidence runs into their
surroundings and renumbers speakers by first appearance. Hard limits: 3 speakers at once, 240 min per file.
The README documents why word-level timestamps were measured and rejected — don't reintroduce them.

**Exports (`src/lib/exporters.ts`, `src/lib/zip.ts`).** txt/srt/vtt/json are all rendered from the one
stored `TranscriptResult`; lines get a speaker prefix when chunks carry speakers — the user's name from
`job.speakerNames` (per job, edited in `JobQueue`) or `Speaker N` — and JSON's `text` is built from `toTxt()`
so all formats agree. JSON keeps numeric `speaker` per chunk plus a `speakers` id→name map. Several formats are saved as one store-only ZIP because browsers
silently block bursts of downloads.

**Podcasts (`src/lib/podcasts.ts`).** iTunes Search API (CORS-enabled) to find shows; RSS and audio are
fetched directly and fall back to the same-origin `public/proxy.php` (PHP + cURL, basic SSRF guard). In dev,
the `devPodcastProxy` plugin in `vite.config.ts` serves `/proxy.php` (`apply: 'serve'`, so not in preview).

**Deployment.** `dist/` is static files for Apache; `public/.htaccess` forces HTTPS (needed for mic and
WebGPU) and adds an SPA fallback. The dev server sends COOP/COEP (multithreaded WASM); production doesn't
need them.

**Persistence (`src/lib/storage.ts`).** Finished jobs (result, `originalResult`, `speakerNames`, label…) are
saved to IndexedDB and restored on load as `restored` jobs via `jobFromSaved()`; media is never stored, so
restored jobs can't play lines. Settings live in `localStorage` and pass through `restoreSettings()`, which
falls back to defaults field by field. In `App.tsx`, a throttled save pass (≤ once per 400 ms — not a debounce,
because progress ticks change `jobs` constantly) writes changed jobs and deletes ones that left the list; it
also flushes on `visibilitychange`/`pagehide`. Writes resolve on transaction commit; storage failures are
silent except for an on-page note. Queued/running jobs aren't saved — without their files they can't resume.

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
