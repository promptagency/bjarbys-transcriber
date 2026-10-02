# Pianissimo spike

Throwaway harness to decide whether Klang AI's Swedish **Pianissimo** model
(FastConformer-TDT, 0.6B, CC BY 4.0) can run in this app's browser-only setting,
and how it compares with KB-Whisper on the same audio. Not shipped code.

## Setup

```bash
npm install
node spike/patch-parakeet.mjs          # parakeet.js ignores `wasmPaths`; see below

# Fixture: FLEURS sv_se test split (CC BY 4.0), first reading of each sentence
curl -LO https://huggingface.co/datasets/google/fleurs/resolve/main/data/sv_se/test.tsv
curl -L https://huggingface.co/datasets/google/fleurs/resolve/main/data/sv_se/audio/test.tar.gz | tar xz
node scripts/build-fleurs-sv-fixture.mjs . public/spike-fixture 60

# Same-origin ONNX Runtime (parakeet.js's own copy, 1.24.1)
mkdir -p public/spike-ort
cp node_modules/parakeet.js/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{mjs,wasm} public/spike-ort/

# Model files, served by the dev server (parakeet.js's IndexedDB cache drops the encoder)
mkdir -p public/spike-models/pianissimo && cd public/spike-models/pianissimo
for f in encoder-model.int8.onnx decoder_joint-model.onnx vocab.txt; do
  curl -LO https://huggingface.co/KlangAI/pianissimo-sv-onnx/resolve/main/$f; done
# WebGPU encoder: symmetric 4-bit, made from Klang's fp32 export
python spike/quantize-encoder.py <dir with encoder-model.onnx(.data)> public/spike-models/pianissimo/encoder-model.sym4.onnx

npx vite --force
open "http://localhost:5173/spike/pianissimo.html"
```

`public/spike-*` is git-ignored. Every form field is also a URL parameter, plus
`auto=1` to start immediately, e.g.
`?engine=pianissimo&backend=webgpu&quant=sym4&dec=fp32&n=60&long=1&auto=1`.

## Results (2026-10-02, MacBook Pro, Chrome 153, dev server)

FLEURS sv_se test, first 60 distinct sentences (12.8 min, 1,387 words); WER with
Klang's normalization. Speed = audio time / processing time, model already loaded.

| Engine | Backend | Clip WER | Clip speed | 13 min file | Download | Memory* |
|---|---|---:|---:|---:|---:|---:|
| **Pianissimo**, sym4 encoder + fp32 decoder (1 thread) | WebGPU | **6.85%** | **6.9×** | 8.72% WER, 7.5× | ~765 MB | 2.0 GB |
| KB-Whisper Small, q4f16 tier | WebGPU | 8.07% | 1.4× | – | 586 MB | 1.5 GB |
| KB-Whisper Base, q4f16 tier (app default) | WebGPU | 10.24% | 2.7× | hung† | 206 MB | 1.2 GB |
| Pianissimo, int8 encoder + int8 decoder | WASM | – | ~0.3× | – | 660 MB | – |

\* `measureUserAgentSpecificMemory`, page + workers; GPU memory not included.
† The worker went silent ~9 min into the long file; not investigated.

What didn't work:
- **WASM / int8**: ORT Web's integer kernels are slow and barely threaded — 39 s
  encode + 14 s decode for a 16 s clip. Not viable on CPU.
- **fp16 encoder on WebGPU**: `std::bad_alloc` creating the session (1.25 GB).
- **Published 4-bit encoders** (KlangAI int4, s0undy q4): asymmetric with zero
  points → ORT Web 1.24 WebGPU MatMulNBits fails ("zeroPoints input size
  error"). Symmetric re-quantization (`quantize-encoder.py`) fixes it.
- **Decoder threads**: the TDT decoder runs one tiny ORT call per frame; the
  10-thread pool made it 2× slower than 1 thread.

## parakeet.js 1.4.4 issues found (worked around here)

1. **Spaces dropped before å/ä/ö** in `tokenizer.decode`: the "no space before
   punctuation" rule uses ASCII-only `\w`, so "kemiska ämnen" → "kemiskaämnen".
   The spike overrides `decode`. Word-level output (long audio) is unaffected.
2. **`wasmPaths` is ignored**; ORT always loads from jsdelivr. From the CDN the
   WASM thread pool never starts. `patch-parakeet.mjs` fixes it.
3. **`backend: 'webgpu'` with `fromUrls` creates sessions with an empty provider
   list** (logged `Providers: []`); only `webgpu-hybrid` sets the WebGPU
   provider. Whether ORT then still picks WebGPU was not verified. The spike
   maps to `webgpu-hybrid`.
4. ~~IndexedDB cache silently fails~~ **Probably not a parakeet.js bug.** The
   encoder never stayed cached, but the later integration saw the same with the
   Cache API: the test Chrome profile refused more than ~300 MB per origin
   (`QuotaExceededError`) while `navigator.storage.estimate()` reported ~11 GB.
   The likely cause is that browser storage limit.
