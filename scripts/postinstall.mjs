// Runs after `npm install`. Prepares parakeet.js (the Pianissimo runtime):
//
//  1. Patches two bugs in parakeet.js 1.4.4 (idempotent; fails loudly if the
//     library changed underneath, so an upgrade can't silently drop a fix):
//     - `wasmPaths` is accepted but never applied, so ONNX Runtime always
//       loads from cdn.jsdelivr.net — a third-party request this app promises
//       not to make.
//     - decode() drops the space before any word starting with å/ä/ö: its
//       "no space before punctuation" rule uses JS's ASCII-only \w, so
//       "kemiska ämnen" decodes as "kemiskaämnen".
//  2. Copies parakeet.js's own ONNX Runtime (separate from the copy
//     transformers.js uses) into public/ort-parakeet/<version>/, so it is
//     served from this site in dev and emitted into dist/ by the build. The
//     version is in the path because .htaccess caches .mjs as immutable.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PKG = "node_modules/parakeet.js";
if (!existsSync(PKG)) process.exit(0); // e.g. a production-only install

function patch(file, before, after) {
  const path = join(PKG, file);
  const src = readFileSync(path, "utf-8");
  if (src.includes(after)) return;
  if (!src.includes(before)) {
    throw new Error(`parakeet.js patch target not found in ${file} — the library changed; re-check the fix`);
  }
  writeFileSync(path, src.replace(before, after));
  console.log(`patched ${path}`);
}

patch(
  "src/backend.js",
  "  if (!ort.env.wasm.wasmPaths) {",
  "  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;\n  if (!ort.env.wasm.wasmPaths) {",
);
patch(
  "src/tokenizer.js",
  "text = text.replace(/\\s+(?=[^\\w\\s])/g, '');",
  "text = text.replace(/\\s+(?=[^\\p{L}\\p{N}_\\s])/gu, '');",
);

// parakeet.js pins its own onnxruntime-web; npm may hoist or nest it.
const ortVersion = JSON.parse(readFileSync(join(PKG, "package.json"), "utf-8"))
  .dependencies["onnxruntime-web"];
const ortDist = [
  join(PKG, "node_modules/onnxruntime-web/dist"),
  "node_modules/onnxruntime-web/dist",
].find((dir) => {
  if (!existsSync(dir)) return false;
  const pkg = JSON.parse(readFileSync(join(dir, "../package.json"), "utf-8"));
  return pkg.version === ortVersion;
});
if (!ortDist) throw new Error(`parakeet.js's onnxruntime-web ${ortVersion} not found`);

// Same path as PARAKEET_ORT_VERSION in vite.config.ts resolves to.
const out = `public/ort-parakeet/${ortVersion}`;
mkdirSync(out, { recursive: true });
// The JSEP build is the one ORT picks when WebGPU is enabled.
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  copyFileSync(join(ortDist, f), join(out, f));
}
console.log(`copied ONNX Runtime (parakeet.js) → ${out}`);
