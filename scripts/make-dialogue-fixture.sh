#!/usr/bin/env bash
# Build a synthetic, labelled two-person conversation for scripts/eval-diarization.mjs:
# <out>/excerpt.wav (16 kHz mono) + <out>/labels.csv, same format as the real fixture.
#
# Usage: scripts/make-dialogue-fixture.sh [minutes=12] [out=bench-audio/dialogue] [seed=1]
#
# Two macOS voices (Alva and Daniel — Daniel reads Swedish with an English voice,
# which is fine: speaker separation listens to voices, not language) take turns
# reading Lagerlöf (the text of bench-audio/bench-25min.txt; run
# scripts/make-bench-audio.sh first). Like a real interview it has short answers, small
# overlaps at speaker changes, and backchannels ("ja", "mm") spoken *over* the
# other person's turn — the case real recordings get wrong most.
#
# Timestamps are exact, unlike Whisper's, and the voices are synthetic: use it to
# check that a change helps beyond the one real fixture, not as the yardstick.
set -euo pipefail

MINUTES="${1:-12}"
OUT="${2:-bench-audio/dialogue}"
SEED="${3:-1}"
TEXT="bench-audio/bench-25min.txt"
[ -f "$TEXT" ] || { echo "missing $TEXT — run scripts/make-bench-audio.sh 25 first" >&2; exit 1; }

mkdir -p "$OUT/parts"
python3 - "$TEXT" "$OUT" "$MINUTES" "$SEED" <<'PY'
import array, json, random, re, subprocess, sys, wave
text_path, out, minutes, seed = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
rng = random.Random(seed)
SR = 16000
VOICES = {"S": "Alva", "I": "Daniel"}  # S = interviewee, I = interviewer (the eval's labels)
sentences = []
for sentence in re.split(r"(?<=[.!?”])\s+", open(text_path, encoding="utf-8").read().strip()):
    # Whisper's segments are a few seconds long; split long sentences at commas like it does.
    piece = []
    for part in sentence.replace(";", ",").split(", "):
        piece.append(part)
        if len(" ".join(piece).split()) >= 10:
            sentences.append(", ".join(piece)); piece = []
    if piece:
        sentences.append(", ".join(piece))
BACKCHANNELS = ["ja", "mm", "precis", "okej", "jaha", "ja visst", "nej", "absolut", "just det"]
ANSWERS = ["Ja, det stämmer.", "Nej, inte riktigt.", "Absolut.", "Det tror jag.", "Ja.", "Nej.", "Precis så.", "Kanske det."]

cache = {}
def speak(voice, line):
    key = (voice, line)
    if key not in cache:
        path = f"{out}/parts/{len(cache)}.wav"
        subprocess.run(["say", "-v", voice, "-o", path, "--data-format=LEI16@16000", line], check=True)
        with wave.open(path) as w:
            cache[key] = array.array("h", w.readframes(w.getnframes()))
    return cache[key]

utts = []  # (start_s, speaker, text, samples)
t, si, speaker = 0.5, 0, "S"
while t < minutes * 60:
    if rng.random() < 0.25:  # a short answer as a whole turn
        lines = [rng.choice(ANSWERS)]
    else:
        n = rng.choice([1, 1, 2, 2, 3, 4])
        lines, si = sentences[si:si + n], (si + n) % len(sentences)
    turn_start = t
    for line in lines:
        pcm = speak(VOICES[speaker], line)
        utts.append((t, speaker, line, pcm))
        t += len(pcm) / SR + rng.uniform(0.1, 0.5)
    turn_end = t
    other = "I" if speaker == "S" else "S"
    # Backchannels over a longer turn, never in its first or last second.
    if turn_end - turn_start > 6:
        for _ in range(rng.choice([0, 1, 1, 2, 2, 3])):
            at = rng.uniform(turn_start + 1, turn_end - 2)
            word = rng.choice(BACKCHANNELS)
            utts.append((at, other, word, speak(VOICES[other], word)))
    # Next speaker starts after a short gap or slightly overlapping.
    t = turn_end + rng.uniform(-0.4, 0.8)
    speaker = other

utts.sort(key=lambda u: u[0])
total = int((max(s + len(p) / SR for s, _, _, p in utts) + 0.5) * SR)
mix = array.array("i", bytes(4 * total))
for s, _, _, pcm in utts:
    o = int(s * SR)
    for k, v in enumerate(pcm):
        mix[o + k] += v
peak = max(1, max(abs(v) for v in mix))
scale = min(1.0, 30000 / peak)
with wave.open(f"{out}/excerpt.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(array.array("h", (int(v * scale) for v in mix)).tobytes())

with open(f"{out}/labels.csv", "w", encoding="utf-8") as f:
    f.write("idx;time_in_clip;speaker;text;dur_s;rel_start;rel_end\n")
    for i, (s, sp, txt, pcm) in enumerate(utts, 1):
        d = len(pcm) / SR
        f.write(f"{i};{int(s // 60):02d}:{s % 60:05.2f};{sp};{txt};{d:.2f};{s:.2f};{s + d:.2f}\n")
short = sum(1 for _, _, _, p in utts if len(p) / SR < 1.5)
print(json.dumps({"minutes": round(total / SR / 60, 1), "utterances": len(utts), "under_1_5s": short,
                  "backchannels": sum(1 for u in utts if u[2] in BACKCHANNELS)}))
PY
rm -r "$OUT/parts"
