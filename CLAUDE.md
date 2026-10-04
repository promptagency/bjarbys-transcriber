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

Settings are plain React state — nothing is persisted between reloads.

## Repository conventions

- `origin` = `promptagency/vem-sa-vad` (the fork). **Every feature is developed on its own branch**
  (`feature/<name>`), with commits that touch only that feature, and lands on `main` through a PR in this fork.
  Keeping features apart means any one of them can be offered upstream without untangling it from others.
  Small fixes (docs, typos, an isolated bug fix) may go straight to `main`.
- PRs to upstream carry **one feature each**, built on upstream's `main`. A feature that depends on another
  open upstream PR either waits for it to merge or is based on that PR's branch and says so.
- `upstream` = `fltman/bjarbys-transcriber` (Anders's repo, read-only). Never push there; anything public on it
  (issues, PRs, comments) needs the owner's explicit go-ahead. PR #1 there offers speaker separation from the
  `speaker-separation` branch, which was rebuilt by hand from upstream `main` — so syncing upstream into this
  fork needs care (`git merge -s ours` only if upstream equals the merged PR exactly).
- Keep Anders Bjarby's credit visible (README intro, app footer, `LICENSE`) — MIT requires the notice.
- Parked work lives on branches: `feature/pianissimo` (Klang AI's Pianissimo model, WebGPU-only, self-hosted
  765 MB) and `spike/pianissimo` (its benchmark harness and findings).
