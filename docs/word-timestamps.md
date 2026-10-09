# Why not word-level timestamps?

Speaker separation's main error is the short interjection: a backchannel ("Just det.") spoken over
someone who keeps talking (see [speaker-separation.md](speaker-separation.md#known-limits)). The natural
fix looks like attributing *words* rather than phrase chunks: `return_timestamps: 'word'` gives spans
around 0.2 s against ~2 s for phrase chunks, easily fine enough to isolate a half-second "Just det." It
was tried, measured, and **it makes attribution worse.**

## The measurement

Transcribing the fixture twice with the same model and diarizing both, so granularity is the only
variable (`scripts/eval-word-timestamps.mjs`):

| attribution | units | median span | word accuracy |
|---|---|---|---|
| phrase-level (what ships) | 288 | 1.94 s | **98.4%** |
| word-level | 1996 | 0.20 s | 94.7% (−3.7 pp) |
| words regrouped into sentences | 201 | 2.80 s | 97.7% (−0.7 pp) |

The padding really does cause the interjection errors — but it also does useful work everywhere else.
A two-second span covers roughly 120 diarization frames and averages out noise; a 0.2 s word covers
about 12 and can land entirely on a glitch. Removing the padding loses more than it recovers, so
phrase-sized units are the right granularity and the interjection errors are the price of it.

(Those percentages are not comparable to the 95.6% quoted in the README: this experiment uses a
different ASR model and scores against time intervals rather than per labelled utterance. Only the
three rows are comparable to each other.)

## Which models could produce them anyway

The availability problem below is therefore moot — but it is recorded because it took a while to
establish, and "just use word timestamps" is an obvious thing to suggest.

Word timestamps are derived from the decoder's **cross-attentions**, and the ONNX models this app loads
are not exported with them:

```
Model outputs must contain cross attentions to extract timestamps.
This is most likely because the model was not exported with `output_attentions=True`.
```

Having `alignment_heads` in `generation_config.json` is not sufficient — every model here declares it
and still fails. What the export needs is the cross-attentions themselves, and each candidate was
checked:

| build | word timestamps |
|---|---|
| `KBLab/kb-whisper-*` | ✗ no cross-attentions |
| `onnx-community/kb-whisper-*-ONNX` | ✗ no cross-attentions |
| `pappa1337/kb-whisper-{tiny,small}-onnx-words` | ✗ won't load — transformers.js reports `Unsupported model type: whisper` |
| `onnx-community/whisper-*_timestamped` (13 of them) | ✓ works, verified |

So the blocker is specific: **no working KB-Whisper build exposes cross-attentions.** The
`_timestamped` variants that do work include multilingual ones, and those *can* transcribe Swedish —
this is a real option, not an impossibility. It just means giving up KB-Whisper's Swedish accuracy for
generic Whisper, plus re-downloading a different model. Whether better speaker attribution outweighs
worse transcription has not been measured.

Exporting KB-Whisper with `output_attentions=True` would remove that obstacle — but the measurement
above says it would not be worth doing, since finer spans attribute worse. The containment rule for
short lines and `speaker_conf`, which flags about 40% of the remaining errors, are the mitigations
instead.
