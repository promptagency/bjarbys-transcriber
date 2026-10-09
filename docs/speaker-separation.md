# Speaker separation

Ticking **Dela upp på talare** (*Separate speakers*) additionally loads
[`onnx-community/pyannote-segmentation-3.0`](https://huggingface.co/onnx-community/pyannote-segmentation-3.0)
— an ONNX build of [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), about
1.5 MB, MIT. It runs on WASM alongside Whisper and needs no extra dependency.

## How it works

The worker runs the pyannote model over the same 16 kHz audio Whisper heard and decodes its *powerset*
output into per-speaker activity spans — silence and simultaneous speech are *not* speakers, which is
easy to get wrong. `src/lib/diarize.ts` then gives each Whisper chunk to whoever holds the floor longest
across it — except a short line with a second voice active, which goes to the speaker whose speech is
most contained in it — and merges away brief low-confidence blips.

## In the exports

Each chunk in the `.json` export carries `speaker` and `speaker_conf`, and the other formats prefix each
line with `Talare N:` (or `Speaker N:` with the interface in English).

**Naming speakers.** Open a finished transcript to get one field per detected speaker, applied
immediately to the transcript, Copy and downloads. Names are per transcript, since "Talare 1" is a
different person in every recording. In the documents, `.srt`/`.vtt` and Copy the name replaces
`Talare N`; in `.json` the chunks keep their numeric `speaker` and a top-level `speakers` object maps
each number to its name. An automatic download happens before you've named anyone, so download again
after naming.

## The review view

The open transcript is also a view for checking and correcting it line by line:

- **▶ plays that line** from the original file, stopping at its end.
- **Unsure lines are highlighted** in amber — where the model's margin between the top two speakers is
  low, or it found no speaker — and *Only unsure lines* filters to them. In testing, these were the
  lines where two voices overlapped.
- **Change a line's speaker** (including *New speaker* or *No speaker*) or **click its text to edit
  it**. Enter or clicking elsewhere saves, Esc cancels; text is kept on one line so subtitle cues stay
  valid.
- **Revert** undoes your changes to a line.
- **Find & replace** fixes a name or term Whisper mishears the same way every time, in one go: matches
  are highlighted and counted as you type, *Only lines with matches* shows just those lines, and
  **Replace all** changes them (each changed line can still be reverted on its own). **Undo** takes back
  the whole replacement, leaving any line you changed since alone. Whole words and ignore-case are on by
  default, å/ä/ö count as letters, and the text you type is matched literally. An empty replacement
  deletes the word and tidies up the punctuation around it ("Ja, eh, det" → "Ja, det").

Corrections flow into Copy and every export; corrected chunks carry `"edited": true` in `.json`, and a
speaker you set has `speaker_conf` 1 (0 for *No speaker*). If you've opted in to keeping transcripts,
edits and names are kept with them across reloads.

## Accuracy

**95.6%** of words attributed to the correct speaker, on a hand-labelled 12-minute two-person Swedish
interview (231 utterances, 2116 words). Lines where no speaker was detected count as wrong. Reproduce
with `scripts/eval-diarization.mjs` (see [below](#evaluating-speaker-separation)).

## Known limits

That figure is for a clean recording of two people.

- **At most 3 speakers.** The model reports speaker activity as a *powerset* over three local speakers,
  so a fourth voice cannot be represented at all. A prototype for more speakers (voice fingerprints and
  clustering) lives on the `spike/multi-speaker` branch; on a real four-person recording it couldn't
  tell two similar voices apart, so it isn't in the app.
- **Long recordings are stitched, not seamless.** A single pass eventually exhausts the browser's WASM
  memory, so audio is diarized in windows that overlap by two minutes, and speakers are matched across
  each seam by who is talking at the same moments. How much fits in one pass depends on the device and
  on how much the chosen Whisper model has already claimed, so the window starts at 25 minutes and
  halves on retry if a pass runs out of memory. A 67-minute two-person interview comes out as 2
  speakers. But someone who stays silent through an entire overlap cannot be matched and is given a
  fresh label rather than a guessed one, so very long or very lopsided recordings may still show extra
  speakers. Files over 240 minutes aren't separated.
- **Short interjections are still the main error.** A backchannel ("Just det.") spoken over someone
  still talking sits in a chunk whose audio is dominated by the other speaker, so "who talks longest"
  gets it wrong. For lines under 1.5 s where a second voice is clearly active, the speaker whose speech
  is most *contained* in the line now wins instead — an interjection starts and ends with it, while the
  other person talks straight through. That took the interview from 94.7% to 95.6% (22 → 21 wrong lines,
  14 → 12 of 34 short lines wrong) and a synthetic dialogue full of backchannels from 95.7% to 99.8%
  (`scripts/make-dialogue-fixture.sh`; details in [benchmark.md](benchmark.md)). Most of the remaining
  wrong words are still in short lines. The obvious fix, word-level timestamps, was measured and makes
  attribution worse — see [word-timestamps.md](word-timestamps.md).
- **`speaker_conf`** is the margin between the top two speakers' talk time within a chunk. Low values
  mean overlapping speech rather than a wrong answer; `speaker` is `null` where no speech was detected
  at all. For a short line decided by containment it is the margin in containment instead. About 40% of
  the remaining errors are flagged this way.

## Evaluating speaker separation

`scripts/eval-diarization.mjs` scores the shipping code against a hand-labelled fixture, so changes to
diarization can be measured instead of eyeballed.

```bash
node --experimental-strip-types scripts/eval-diarization.mjs <fixture-dir> [windowMinutes]
```

The fixture lives outside the repo — real recordings are usually confidential — and the directory needs
two files:

| file | contents |
|---|---|
| `labels.csv` | `idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end;…`, one row per utterance, `speaker` hand-filled (`,` or `;` separated) |
| `excerpt.wav` | the same audio, 16 kHz mono |

It reports word-level accuracy, the number of distinct speakers, speaker changes landing on a window
boundary, and duplicated spans. Pass `windowMinutes` to force the windowed path on a short clip — handy
for exercising boundary behaviour without labelling hours of audio.
