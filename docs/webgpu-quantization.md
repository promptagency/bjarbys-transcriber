# Whisper quantization on WebGPU (measured 2026-10-05)

Question: is the old rule "on WebGPU the encoder must stay fp32" (`src/worker.ts`) still true?

Setup: a throwaway harness (kept on branch `spike/webgpu-encoder`, `src/spike-webgpu.ts`) ran the ASR pipeline on WebGPU on the main thread, with the app's options
(30 s chunks, 5 s stride, timestamps, `sv`). Audio: 45 s of Swedish read by macOS `say -v Alva` from a
known 112-word script. Score is word error rate (WER) against the script. Hardware: Apple GPU (Metal 3,
`shader-f16` reported), Chrome 153. Run times were measured in a hidden tab and are only roughly comparable.

| lib | model | encoder | decoder | WER | run s | note |
|---|---|---|---|---|---|---|
| 3.8.1 | base | fp32 | q4 | 1.8% | 26 | current app tier (≈195 MB) |
| 3.8.1 | base | fp16 | q4 | 175% | 53 | garbage |
| 3.8.1 | base | q8 | q4 | 100% | 122 | empty |
| 3.8.1 | base | q4 | q4 | 2.7% | 31 | works |
| 3.8.1 | base | q4f16 | q4 | 124% | 79 | garbage |
| 3.8.1 | base | fp32 | q4f16 | 100% | 78 | garbage |
| 3.8.1 | base | fp32 | fp16 | 100% | 78 | garbage |
| 3.8.1 | small | q4 | q4 | 0% | 48 | works |
| 3.8.1 | small | fp32 | q4 | 0.9% | 47 | current tier (≈558 MB) |
| 4.3.0 | base | fp32 | q4 | 1.8% | 26 | |
| 4.3.0 | base | q4 | q4 | 2.7% | 20 | |
| 4.3.0 | base | fp16 | q4 | 1.8% | 22 | fixed in v4 |
| 4.3.0 | base | fp32 | q4f16 | 1.8% | 21 | fixed in v4 |
| 4.3.0 | base | q8 | q4 | 2.7% | 41 | works, slow |
| 4.3.0 | base | q4f16 | q4f16 | 1.8% | 21 | ≈78 MB |
| 4.3.0 | base | q4 | q4f16 | 2.7% | 24 | |
| 4.3.0 | base | fp16 | q4f16 | 1.8% | 23 | ≈104 MB |
| 4.3.0 | base | fp32 | q8 | 0.9% | 263 | correct but ~10× slower |
| 4.3.0 | small | q4f16 | q4f16 | 1.8% | 32 | ≈189 MB |
| 4.3.0 | small | fp16 | q4f16 | 1.8% | 36 | ≈306 MB |

## Second test: language switch, no language set

`twovoice.wav`: 22 s of Swedish (Alva) followed by 8 s of English (Daniel), model `Xenova/whisper-base`, no
language given (the app's "Any language"). Every configuration renders the Swedish part as English (Whisper
detects one language) — that is how this model behaves, not a regression. What differs is whether the English
part at the end survives:

| lib | encoder | decoder | English part kept? |
|---|---|---|---|
| 3.8.1 | fp32 | q4 | partly (first sentence) |
| 4.3.0 | fp32 | q4 | yes |
| 4.3.0 | fp16 | q4 | yes |
| 4.3.0 | fp32 | q4f16 | yes |
| 4.3.0 | fp16 | q4f16 | yes — **chosen** |
| 4.3.0 | q4 | q4 | **no** |
| 4.3.0 | q4f16 | q4 | **no** |
| 4.3.0 | q4f16 | q4f16 | **no** |

A 4-bit encoder loses the language switch even though it scored well on clean Swedish, so the app keeps the
encoder at 16 bits and only puts the decoder (the larger half) at 4 bits.

## Checks of the chosen tier (fp16 encoder + q4f16 decoder, 4.3.0)

- KB-Whisper Base in the app, 22 s Swedish: 0% WER; Medium (harness): 0% WER on the same clip.
- Xenova/whisper-base in the app on the language-switch file, speaker separation on: English part kept,
  speakers split correctly at 0:22.
- Forcing "no `shader-f16`" loads `encoder_model.onnx` + `decoder_model_merged_q4.onnx` and transcribes normally.
- Speaker-separation eval (`scripts/eval-diarization.mjs`) on 4.3.0: 94.7% word accuracy, unchanged.

The app ships with `onnxruntime-web` overridden to the stable 1.30.0 (Transformers.js 4.3.0 pins
1.31.0-dev.20260914). On 1.30.0 the checks above were repeated in the app — Swedish on GPU 0% WER, the
language-switch file with speaker separation (English kept, split at 0:22), CPU with speaker separation — with
the same results. The spike tables above were measured on the pinned dev build.

## Findings

- On 3.8.1 anything 16-bit (encoder **or** decoder) breaks on this GPU, as does a q8 encoder; a **q4 encoder works**
  (base and small). The old note blamed encoder quantization in general; on this setup it is 16-bit maths.
- 4.3.0 fixes the 16-bit failures.
- 4-bit encoders drop speech after a language switch (second test). The app's GPU tier is therefore an **fp16
  encoder + q4f16 decoder** (base ≈110 MB instead of ≈206, small ≈322 instead of ≈586, medium ≈951 instead of
  ≈1699, large ≈1884 instead of ≈3346). GPUs without `shader-f16` get the old fp32 encoder + q4 decoder.
- 8-bit decoders are accurate on WebGPU but far too slow; keep them CPU-only.

Not tested: other GPUs (NVIDIA/AMD/Intel, Windows), a real GPU without `shader-f16`, large/turbo and the
English-only models, real noisy recordings, long audio, and whether the rest of the app (worker, diarization, WASM path)
works unchanged on transformers.js 4.x (the last point is covered by the upgrade PR's own tests).
