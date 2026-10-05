# Benchmark

How fast and how accurate is a transcription? Measure before and after any change that claims to improve
either.

## Running it

1. Make a recording with a known script (macOS only — uses the `say` voice Alva):

   ```bash
   scripts/make-bench-audio.sh 25        # → bench-audio/bench-25min.wav + .txt (gitignored)
   ```

   The text is Selma Lagerlöf's *Valda berättelser* (public domain, Project Gutenberg #51440), stories only —
   the edition's English footnotes and vocabulary are stripped.

2. `npm run dev`, open <http://localhost:5173/bench.html>, pick the `.wav` and, for word error rate, the
   `.txt`. Choose model, device, quality and language, and press **Run**. **Keep the tab visible**: Chrome
   throttles background tabs and the numbers become meaningless.

3. **Copy results as Markdown** gives a table with the browser, GPU and thread count, ready to paste below.

The page drives the app's own worker (`src/worker.ts`), so it measures exactly what the app does. Any audio or
video file works, including your own recordings — they are read in the page and never uploaded or copied.
`bench.html` is served by the dev server only; `npm run build` leaves it out.

**Columns:** *Decode* — file to 16 kHz PCM on the main thread. *Load* — model load (a cold first load includes
the download). *Transcribe* — Whisper only. *× real time* — audio length ÷ transcribe time. *Speakers* —
speaker separation. *WER* — word error rate against the reference, ignoring case and punctuation
(`src/lib/wer.ts`).

**Caveats.** Synthetic speech is clean and evenly paced, so its WER is a best case, and it has no silences or
crosstalk. Use it to compare settings against each other; check real recordings before drawing conclusions
about accuracy. Part of the WER is formatting, not mishearing — the model writes "Gustav III" where the script
says "Gustav den tredje".

## Baseline — 2026-10-05

Apple M1 Pro (32 GB), Chrome 153, WebGPU (Apple Metal 3, `shader-f16`), 10 CPU threads.
`bench-25min.wav`: 1519 s, 4239 reference words. Model already cached (warm load).

| Model | Quality | Device | Decode s | Load s | Transcribe s | × real time | Speakers s | WER | Words |
|---|---|---|---|---|---|---|---|---|---|
| KB-Whisper Base | q4f16 | webgpu | 2.5 | 1.6 | 269.9 | 5.6× | – | 10.4% | 4386 |
| KB-Whisper Base | q4f16 | webgpu | 2.5 | 1.6 | 268.2 | 5.7× | 16.5 | 10.4% | 4386 |
| KB-Whisper Base | q8 | wasm | 2.4 | 1.4 | 203.2 | 7.5× | – | 10.3% | 4331 |

Observations:

- Transcription is ~94% of the time; speaker separation is ~6%. Speed work should target Whisper.
- **On this Mac the CPU beats the GPU for Base**: 203 s vs 268 s on the same file, same accuracy (a 2-minute
  file agrees: 16.3 s vs 18.3 s). The dev server sends COOP/COEP, so WASM runs multithreaded here; a plain
  static deployment without those headers would run the CPU single-threaded and much slower. Larger models
  have not been compared yet.
- The output has 147 more words than the script (4386 vs 4239). Part is formatting, but repeated text at the
  overlaps between 30-second chunks is a suspect worth checking.

## Chunk overlap — 2026-10-05

Whisper hears 30-second windows; neighbouring windows overlap by the *stride* on each side, and Transformers.js
merges the twice-transcribed overlap. Same machine and file as the baseline, KB-Whisper Base, q4f16, WebGPU.
*Repeats* = distinct 6-word phrases that occur more often in the transcript than in the script.

| Overlap per side | Transcribe s | × real time | WER | Words | Dropped | Inserted | Repeats |
|---|---|---|---|---|---|---|---|
| 5 s (Transformers.js default, the app until now) | 268 | 5.7× | 10.4% | 4386 | 38 | 196 | 86 |
| **2.5 s (the app now)** | **171** | **8.9×** | **7.2%** | **4240** | 38 | 50 | 1 |
| 1 s | 157 | 9.7× | 7.6% | 4210 | 62 | 44 | 0 |
| 0 s | 147 | 10.3× | 8.0% | 4196 | 72 | 40 | 0 |

- **At 5 s the merge sometimes fails**: 160 of the 196 inserted words were 12 runs of whole repeated
  sentences, almost all starting 1–6 s before a window boundary.
- **Without overlap words are lost at the cuts**: at 0 s, 40 of the 72 dropped words lie within 2 s of a
  30-second cut (13% would be chance).
- **Real speech** (the private 12-minute interview excerpt, Node, CPU): 5 s → 13 repeated 6-word phrases in
  46 s; 2.5 s → 0 in 38 s. No independent reference exists for that recording, so its WER is not measured.
