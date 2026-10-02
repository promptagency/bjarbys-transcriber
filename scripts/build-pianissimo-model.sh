#!/usr/bin/env bash
# Build the Pianissimo model files the app loads (~765 MB), into
# public/models/pianissimo/ so `npm run dev` serves them and `npm run build`
# copies them into dist/.
#
#   scripts/build-pianissimo-model.sh [out-dir]
#
# Needs curl and python3. Downloads Klang AI's fp32 ONNX export (~2.5 GB,
# CC BY 4.0) into a temp dir and re-quantizes the encoder to symmetric 4-bit:
# the 4-bit files Klang publishes use zero points, which ONNX Runtime Web's
# WebGPU kernel rejects. See scripts/quantize-pianissimo-encoder.py.
#
# To host the files elsewhere (e.g. a Hugging Face repo), upload the three
# output files and build with VITE_PIANISSIMO_MODEL_URL=<url ending in />.
set -euo pipefail

OUT="${1:-public/models/pianissimo}"
REPO="https://huggingface.co/KlangAI/pianissimo-sv-onnx/resolve"
REV="63730c6021234f26b9bbae9a07a04fec39e7a52e" # pinned so rebuilds are reproducible

# A progress bar only on a terminal: when output is captured, every redraw
# piles up as text.
if [ -t 2 ]; then CURL_PROGRESS=(--progress-bar); else CURL_PROGRESS=(-sS); fi
fetch() { curl -fL "${CURL_PROGRESS[@]}" -o "$1" "$2"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

echo "Downloading Klang's fp32 encoder (~2.5 GB) …"
fetch "$WORK/encoder-model.onnx" "$REPO/$REV/encoder-model.onnx"
fetch "$WORK/encoder-model.onnx.data" "$REPO/$REV/encoder-model.onnx.data"

# The fp32 decoder: the int8 one is 3x slower on WASM, where the decoder runs.
echo "Downloading the decoder and vocabulary …"
fetch "$OUT/decoder_joint-model.onnx" "$REPO/$REV/decoder_joint-model.onnx"
fetch "$OUT/vocab.txt" "$REPO/$REV/vocab.txt"

echo "Quantizing the encoder to symmetric 4-bit …"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q onnx onnxruntime onnx_ir
"$WORK/venv/bin/python" scripts/quantize-pianissimo-encoder.py "$WORK" "$OUT/encoder-model.sym4.onnx" 32

ls -lh "$OUT"
