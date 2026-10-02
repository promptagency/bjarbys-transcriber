// parakeet.js 1.4.4 accepts `wasmPaths` but never applies it, so ONNX Runtime
// always loads its WASM from jsdelivr. Apply the option. Idempotent.
//   node spike/patch-parakeet.mjs && npx vite --force
import { readFileSync, writeFileSync } from "node:fs";

const file = "node_modules/parakeet.js/src/backend.js";
const src = readFileSync(file, "utf-8");
const before = "  if (!ort.env.wasm.wasmPaths) {";
const after = "  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;\n" + before;
if (src.includes(after)) {
  console.log("already patched");
} else if (src.includes(before)) {
  writeFileSync(file, src.replace(before, after));
  console.log("patched", file);
} else {
  throw new Error("patch target not found — parakeet.js changed");
}
