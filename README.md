# Bjarbys Transcriber

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

Private, **in-browser** audio &amp; video transcription. The Whisper model runs
entirely on the user's machine via [Transformers.js](https://github.com/huggingface/transformers.js)
(WebGPU, with a WASM/CPU fallback). **Nothing is uploaded** and **nothing needs
to be installed** — just open the page.

## Features

- 🎙️ **Three sources, one queue** — drop **multiple audio/video files**, record
  from the **microphone**, or search a **podcast** by name and pick episodes.
  Everything feeds a single queue that transcribes sequentially and (optionally)
  **auto-downloads** each transcript.
- 🇸🇪 **Swedish that actually works** — choose **KB-Whisper** (KBLab / National
  Library of Sweden) tiny → large, alongside standard multilingual and
  English-only Whisper models.
- 🎚️ **Pick your model & size** — every model offers quantization tiers with the
  real download size shown; backend-aware so you can't pick a broken combo.
- 🎬 **Audio _and_ video** — MP3, WAV, M4A, OGG, FLAC and MP4 / MOV / WebM
  (the browser extracts the audio track).
- 📝 **Export** to `.txt`, `.srt`, `.vtt`, and `.json` (with timestamps) — tick
  as many formats as you like; the audio is only analysed once and every format
  is rendered from that same result. Picking several saves them as one `.zip`.
- 🗣️ **Speaker separation** (optional, experimental) — labels each line
  `Speaker 1`, `Speaker 2`, … via
  [pyannote](https://huggingface.co/pyannote/segmentation-3.0). Off by default;
  see [the caveats](#speaker-separation) before relying on it.
- 🔒 **Private by design** — transcription is 100% local; models download once
  from the Hugging Face CDN and cache in your browser.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build & deploy to a LAMP server

```bash
npm run build    # outputs static files to dist/
```

Copy the **contents of `dist/`** into your Apache web root (or a subfolder).
A ready-to-use **`.htaccess`** and the podcast **`proxy.php`** are included in
`public/` and are emitted into `dist/` by the build.

- **HTTPS is required** for the microphone (`getUserMedia`) and WebGPU. The
  `.htaccess` force-redirects to HTTPS (localhost is exempt).
- **No COOP/COEP headers needed** for WebGPU or single-threaded WASM — they're
  left commented out in `.htaccess`.
- **Serving from a subfolder?** Set `base: '/yourpath/'` in `vite.config.ts`,
  rebuild, and adjust the `RewriteBase` / fallback lines in `.htaccess`.

### Podcasts &amp; `proxy.php`

Searching uses Apple's iTunes API (CORS-enabled, direct). Most podcast hosts,
however, block cross-origin reads of their RSS/audio, so the app first tries a
**direct fetch** and falls back to a **same-origin proxy** — `proxy.php` — which
your own server fetches through. This keeps it private to your server (no
third-party CORS proxy). `proxy.php` needs PHP with cURL and includes basic
SSRF protection; harden it (e.g. a host allow-list) before public exposure. If
you don't deploy `proxy.php`, file and microphone transcription still work, and
podcasts work for any host that happens to send CORS headers.

## Models

| Group | Models | Notes |
|---|---|---|
| **Swedish — KB-Whisper** | tiny · base · small · medium · large | Best Swedish accuracy. `large`/`medium` are big — use WebGPU. |
| **Multilingual — Whisper** | tiny · base · small · large-v3-turbo | ~100 languages. Turbo is the fast flagship (WebGPU). |
| **English — Whisper** | tiny · base · small (`.en`) | Slightly better on English. |

Quantization: **4-bit (q4f16)** is the small/fast default on **WebGPU**;
**8-bit (q8)** is the default on **CPU/WASM** (an 8-bit *decoder* misbehaves on
WebGPU, so it's offered only on CPU); **full (fp32)** is available for the
smaller models.

### Speaker separation

Ticking **Separate speakers** additionally loads
[`onnx-community/pyannote-segmentation-3.0`](https://huggingface.co/onnx-community/pyannote-segmentation-3.0)
— an ONNX build of [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0),
about 1.5 MB, MIT. It runs on WASM alongside Whisper and needs no extra
dependency. Each chunk in the `.json` export then carries `speaker` and
`speaker_conf`, and the other formats prefix each line with `Speaker N:`.

**Measured accuracy: 95.4%** of words attributed to the correct speaker, on a
hand-labelled 12-minute two-person Swedish interview (231 utterances, 2116
words). Reproduce with `scripts/eval-diarization.mjs` — see
[Evaluating speaker separation](#evaluating-speaker-separation).

That figure is for a clean recording of two people. Known limits:

- **At most 3 speakers.** The model reports speaker activity as a *powerset*
  over three local speakers, so a fourth voice cannot be represented at all.
- **Identity resets past ~50 minutes.** Longer recordings are diarized in
  windows, because a single pass exhausts the browser's WASM memory beyond
  roughly an hour, and the model carries no speaker identity across windows.
  Below that threshold it's one pass and identity is stable throughout.
  Attribution stays just as accurate when windowed — it's only the *labels*
  that restart, so a long file shows more speakers than were in the room.
- **Short interjections are the main error.** 43% of the wrong words sit in
  utterances under 1.5 s — typically a backchannel ("Just det.") spoken over
  someone still talking. A chunk's audio is dominated by the other speaker
  even though the transcribed words are the interjector's, so time-weighted
  attribution gets it wrong, sometimes confidently. Word-level ASR timestamps
  would be the fix.
- **`speaker_conf`** is the margin between the top two speakers' talk time
  within a chunk. Low values mean overlapping speech rather than a wrong
  answer; `speaker` is `null` where no speech was detected at all. About half
  the errors above are already flagged this way.

### Evaluating speaker separation

`scripts/eval-diarization.mjs` scores the shipping code against a hand-labelled
fixture, so changes to diarization can be measured instead of eyeballed.

```bash
node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
```

The fixture lives outside the repo — real recordings are usually confidential —
and the directory needs two files:

| file | contents |
|---|---|
| `labels.csv` | `idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end;…`, one row per utterance, `speaker` hand-filled (`,` or `;` separated) |
| `excerpt.wav` | the same audio, 16 kHz mono |

It reports word-level accuracy, the number of distinct speakers, speaker changes
landing on a window boundary, and duplicated spans. Pass `windowMinutes` to force
the windowed path on a short clip — handy for exercising boundary behaviour
without labelling hours of audio.

## How it works

`src/worker.ts` runs the Transformers.js ASR pipeline in a Web Worker. Audio is
decoded to mono 16 kHz PCM on the main thread (`src/lib/audio.ts`) and
transferred to the worker. Long audio is chunked (`chunk_length_s: 30`) with a
5 s stride. See `src/lib/models.ts` for the model catalog.

Progress comes from a `WhisperTextStreamer`: its chunk callbacks report
timestamps within Whisper's current 30 s window, and the worker reconstructs a
whole-file position from them.

With speaker separation on, the worker runs the pyannote model over the same
PCM and decodes its powerset output into per-speaker activity spans — silence
and simultaneous speech are *not* speakers, which is easy to get wrong.
`src/lib/diarize.ts` then attributes each Whisper chunk to whoever holds the
floor longest across it, and merges away brief low-confidence blips.
