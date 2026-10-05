#!/usr/bin/env bash
# Build a long, reproducible Swedish benchmark recording with a known script:
# Selma Lagerlöf's "Valda berättelser" (public domain, Project Gutenberg
# #51440), read by the macOS voice Alva. Writes <out>/bench-<minutes>min.wav
# (16 kHz mono) and <out>/bench-<minutes>min.txt (the reference text).
#
# Usage: scripts/make-bench-audio.sh [minutes=25] [out=bench-audio] [pause%=0]
#
# pause% > 0 adds silent pauses between sentences until roughly that share of
# the recording is silence (a few long ones, many short ones; fixed seed), for
# measuring how transcription copes with silence. Output is then named
# bench-<minutes>min-pauses<pause%>.wav; the reference text is unchanged.
# Needs macOS `say`, ffmpeg, curl and python3. Synthetic speech is cleaner
# than a real recording, so treat accuracy here as a best case; it is meant for
# comparing settings against each other, and timing.
set -euo pipefail

MINUTES="${1:-25}"
OUT="${2:-bench-audio}"
PAUSES="${3:-0}"
RATE=170 # words per minute for `say`
SOURCE_URL="https://www.gutenberg.org/cache/epub/51440/pg51440.txt"

mkdir -p "$OUT"
base="$OUT/bench-${MINUTES}min"
[ "$PAUSES" != 0 ] && base="${base}-pauses${PAUSES}"

curl -fsSL "$SOURCE_URL" | tr -d '\r' >"$OUT/source.txt"

python3 - "$OUT/source.txt" "$base.txt" "$((MINUTES * RATE))" "$PAUSES" "$RATE" <<'PY'
import random, re, sys
src, dst, want, pauses, rate = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
lines = open(src, encoding="utf-8").read().split("\n")
# The stories run from the first one's heading to the English vocabulary.
start = lines.index("_SILVERGRUVAN_")
end = lines.index("VOCABULARY", start)
keep = []
for line in lines[start:end]:
    if line.startswith("  "):  # footnotes with English glosses are indented
        continue
    if re.fullmatch(r"_[A-ZÅÄÖ .,'-]+_", line.strip()):  # story headings
        continue
    keep.append(line)
text = " ".join(keep)
text = re.sub(r"\[\d+\]", "", text)  # footnote markers
text = text.replace("_", "").replace("--", " – ")
text = re.sub(r"\s+", " ", text).strip()
words = text.split(" ")[:want]
# End on a full sentence so the reference doesn't stop mid-thought.
cut = " ".join(words)
last = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
ref = cut[: last + 1] if last > 0 else cut
open(dst, "w", encoding="utf-8").write(ref + "\n")
# What `say` reads: the reference plus [[slnc ms]] silences after sentences.
speak = ref
if pauses:
    rng = random.Random(51440)
    speech_s = len(ref.split()) / rate * 60
    budget = speech_s * pauses / (100 - pauses)  # silence that makes pause% of the total
    sentences = re.split(r"(?<=[.!?])\s+", ref)
    gaps = [0.0] * len(sentences)
    while budget > 0:
        # Mostly 1-4 s pauses, sometimes 10-60 s stretches (breaks, setup, music).
        g = rng.uniform(10, 60) if rng.random() < 0.08 else rng.uniform(1, 4)
        g = min(g, budget)
        gaps[rng.randrange(len(sentences) - 1)] += g
        budget -= g
    speak = " ".join(s + (f" [[slnc {int(g * 1000)}]]" if g else "") for s, g in zip(sentences, gaps))
open(dst + ".speak", "w", encoding="utf-8").write(speak + "\n")
PY

say -v Alva -r "$RATE" -f "$base.txt.speak" -o "$base.aiff"
ffmpeg -loglevel error -y -i "$base.aiff" -ar 16000 -ac 1 "$base.wav"
rm "$base.aiff" "$base.txt.speak" "$OUT/source.txt"

duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$base.wav")
printf '%s.wav  %.0f s  %s words\n' "$base" "$duration" "$(wc -w <"$base.txt" | tr -d ' ')"
