#!/usr/bin/env bash
# Build a long, reproducible Swedish benchmark recording with a known script:
# Selma Lagerlöf's "Valda berättelser" (public domain, Project Gutenberg
# #51440), read by the macOS voice Alva. Writes <out>/bench-<minutes>min.wav
# (16 kHz mono) and <out>/bench-<minutes>min.txt (the reference text).
#
# Usage: scripts/make-bench-audio.sh [minutes=25] [out=bench-audio]
# Needs macOS `say`, ffmpeg, curl and python3. Synthetic speech is cleaner
# than a real recording, so treat accuracy here as a best case; it is meant for
# comparing settings against each other, and timing.
set -euo pipefail

MINUTES="${1:-25}"
OUT="${2:-bench-audio}"
RATE=170 # words per minute for `say`
SOURCE_URL="https://www.gutenberg.org/cache/epub/51440/pg51440.txt"

mkdir -p "$OUT"
base="$OUT/bench-${MINUTES}min"

curl -fsSL "$SOURCE_URL" | tr -d '\r' >"$OUT/source.txt"

python3 - "$OUT/source.txt" "$base.txt" "$((MINUTES * RATE))" <<'PY'
import re, sys
src, dst, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
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
open(dst, "w", encoding="utf-8").write((cut[: last + 1] if last > 0 else cut) + "\n")
PY

say -v Alva -r "$RATE" -f "$base.txt" -o "$base.aiff"
ffmpeg -loglevel error -y -i "$base.aiff" -ar 16000 -ac 1 "$base.wav"
rm "$base.aiff" "$OUT/source.txt"

duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$base.wav")
printf '%s.wav  %.0f s  %s words\n' "$base" "$duration" "$(wc -w <"$base.txt" | tr -d ' ')"
