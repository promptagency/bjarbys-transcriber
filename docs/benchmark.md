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

## GPU or CPU by default? — 2026-10-05

Should "Auto" prefer the CPU (multithreaded WASM, q8) on this kind of machine? Same machine, 2.5 s overlap.
Multithreading needs `crossOriginIsolated` (the dev server's COOP/COEP); without it the CPU runs on one thread.

5-minute file (`bench-5min.wav`, 848 words):

| Model | GPU (q4f16) | CPU (q8) | GPU WER | CPU WER |
|---|---|---|---|---|
| KB-Whisper Tiny | 33.8 s (9.3×) | 23.6 s (13.4×) | 8.5% | 8.7% |
| KB-Whisper Base | 44.3 s (7.1×) | 34.4 s (9.2×) | 6.4% | 9.8% |
| KB-Whisper Small | 76.0 s (4.2×) | 91.5 s (3.5×)¹ | 8.4% | 5.9% |

¹ The tab went to the background near the end of this run, so the time may be inflated.

25-minute file, KB-Whisper Base: GPU 171 s (8.9×), 7.2% WER; CPU 167.7 s (9.1×), 9.4% WER.

**Decision: keep the GPU as the automatic choice.** For the default model the two are equally fast once the
overlap is 2.5 s (the CPU's earlier lead came from the 5 s overlap's extra work), and the GPU is more accurate
and downloads less (110 MB vs 182 MB). Only Tiny is clearly faster on the CPU, and it is rarely the right model.
WER differences on the 5-minute file (±3 points between devices, in both directions) are within its noise.

## Skip silence before Whisper? — 2026-10-05

Idea: run speech detection (pyannote, already used for speaker separation) first and send only speech to
Whisper. Measured before building it:

- **Real interview:** the private 12-minute excerpt is 97.2% speech by pyannote, with no gap of 2 s or more
  (longest 1.9 s). It is the densest part of its interview, so it is the worst case for this idea, but
  conversations leave little to skip.
- **Synthetic, heavy silence:** `scripts/make-bench-audio.sh 25 bench-audio 30` adds pauses (mostly 1–4 s, some
  10–65 s) to the same script: 2099 s, of which pyannote finds 72.6% speech. KB-Whisper Base, q4f16, WebGPU,
  2.5 s overlap:

  | File | Audio | Transcribe s | × real time | WER | Words |
  |---|---|---|---|---|---|
  | `bench-25min.wav` (no pauses) | 1519 s | 171 | 8.9× | 7.2% | 4240 |
  | `bench-25min-pauses30.wav` | 2099 s | 216.9 | 9.7× | 7.6% | 4257 |

  The 580 s of silence cost 46 s. No transcript segment consisted only of words absent from the script —
  Whisper did not invent text in the silences.

**Decision: not now.** Skipping silence would need speech detection on every file (~6–8% of the time), for at
most ~20% saved on very pause-heavy recordings and a net loss on dense conversations; silence did not cause
hallucinations. Untested: music and background noise, where Whisper is known to invent text — revisit if that
shows up in real use.

## Speaker labels on short lines — 2026-10-05

`scripts/eval-diarization.mjs` (`DIAG=1` prints an error breakdown, counts only) on two labelled fixtures: the
private 12-minute interview (231 scored lines, real Whisper timestamps) and a synthetic 12-minute dialogue from
`scripts/make-dialogue-fixture.sh` (246 lines, 72 backchannels spoken over the other voice, exact timestamps,
Alva + Daniel voices). Before the change, most wrong lines on the interview were interjections inside the other
person's turn (14 of 23 such lines wrong); on the synthetic dialogue every wrong line was under 1.5 s.

Rule: for a line under 1.5 s where the runner-up is active ≥ 40% of it, the speaker with the highest
containment (overlap ÷ union of span and line) wins; `speaker_conf` is the containment margin, so smoothing
leaves confident picks alone.

| Fixture | Before: words / wrong lines / short lines wrong | After |
|---|---|---|
| Interview (real) | 94.7% / 22 / 14 of 34 | **95.6% / 21 / 12 of 34** |
| Synthetic dialogue | 95.7% / 66 / 66 of 100 | **99.8% / 4 / 4 of 100** |

- Results were stable across 1.5–2 s and a 20–40% second-voice threshold, so the rule is not tuned to one
  setting.
- Without the containment margin as confidence, the old smoothing folded the new picks back (synthetic: 29 wrong
  lines instead of 4).
- On the interview, lines of 1.5–3 s went from 6 to 7 wrong (the rule doesn't touch them; the change is in
  how the neighbouring short line is now attributed).
- **The interview figure is the realistic one.** The synthetic fixture feeds the eval its exact utterances; in
  the app, Whisper merges or drops most backchannels spoken over someone else (a 2-minute synthetic dialogue
  with 34 utterances came out as 13 lines), so many never become lines of their own. The interview fixture's
  lines come from Whisper, so its +0.9 points is what to expect.
- Trade-off: fewer lines are flagged unsure (interview: 36 instead of 44), and 8 of the remaining 21 errors are
  flagged (before: 12 of 22).

## KB-Whisper transcription styles — 2026-10-05

KBLab publishes three Stage-2 styles per model as git tags: **subtitle** (condensed), **standard** (the default,
on `main`, what the app uses) and **strict** (closer to verbatim). On their benchmarks strict scores slightly
worse WER (Base: 10.4% vs 9.1% on FLEURS), as expected against tidied references.

None of the alternatives is usable in the browser as published:

- **subtitle** has no `onnx/` folder (tiny, base, small, large; medium has no subtitle tag at all).
- **strict** has an `onnx/` folder, but its files are byte-identical to `main`'s (same LFS hashes for
  `encoder_model_quantized`, `decoder_model_merged_quantized`, `decoder_model_merged_q4f16`), while its
  `model.safetensors` differs. Loading `revision: "strict"` in Transformers.js therefore gives the *standard*
  style — confirmed on the interview excerpt: identical output, word for word.

Using strict would mean exporting its weights to ONNX ourselves (Optimum), quantizing, and hosting the files.
Not done; worth it only if near-verbatim transcripts are wanted.
