# How it works

`src/worker.ts` runs the Transformers.js ASR pipeline in a Web Worker. Audio is decoded to mono 16 kHz
PCM on the main thread (`src/lib/audio.ts`) and transferred to the worker. When the language is left on
auto-detect, the worker asks Whisper which language token it predicts for the first 30 s and transcribes
the whole file in that language (Transformers.js itself would assume English). Long audio is chunked
(`chunk_length_s: 30`) with a 2.5 s overlap on each side — the library's default of 5 s repeated whole
sentences at the seams (see [benchmark.md](benchmark.md)). See `src/lib/models.ts` for the model
catalog.

Progress comes from a `WhisperTextStreamer`: its chunk callbacks report timestamps within Whisper's
current 30 s window, and the worker reconstructs a whole-file position from them. The same streamer
feeds the **live preview**: after each window the worker merges the finished windows' tokens with
Transformers.js's own `_decode_asr` — exactly how the final result is merged — and appends the window in
progress as provisional text. On a 5-minute test the last preview was identical to the finished
transcript.

With speaker separation on, the worker runs the pyannote model over the same PCM — see
[speaker-separation.md](speaker-separation.md#how-it-works).

## Quantization

**Balanced (GPU)** is the default on **WebGPU** — a 16-bit encoder with a 4-bit decoder, about half the
download of full precision with the same accuracy in our tests (GPUs without 16-bit support get a
32-bit encoder instead). **8-bit (q8)** is the default on **CPU/WASM** (an 8-bit *decoder* is ~10×
slower on WebGPU, so it's offered only on CPU); **full (fp32)** is available for the smaller models. The
measurements behind these choices are in [webgpu-quantization.md](webgpu-quantization.md).

## Downloaded models

Transformers.js keeps models and the ONNX runtime in the browser's Cache Storage. Settings › Lagring
(*Storage*) lists them with their sizes and removes one or all; it never touches settings or saved
transcripts. After a model loads, the worker removes the model's other quality levels — keeping both the
GPU and the CPU defaults, since *Automatic* can switch between them — and older ONNX runtimes. Open tabs
keep their lists in step through a `BroadcastChannel`.

## Measuring speed and accuracy

`npm run dev` serves a benchmark page at `http://localhost:5173/bench.html` that runs the app's own
worker on any local file and reports time, × real time and word error rate against a reference text;
`scripts/make-bench-audio.sh` builds a reproducible Swedish recording with a known script (public-domain
Lagerlöf read by the macOS voice Alva). Results and decisions are kept in [benchmark.md](benchmark.md),
including what was measured and deliberately *not* changed: preferring the CPU, skipping silence before
Whisper, and KB-Whisper's "strict"/"subtitle" styles, whose browser builds are not actually published.
