// Developer benchmark (bench.html, dev server only): runs the app's own worker
// on a local file and reports timing and, given a reference text, word error
// rate. Nothing is uploaded; the file never leaves the page.
import { decodeToPCM, durationOf } from "./lib/audio";
import { MODELS, availableTiers, defaultDtype, DTYPE_LABEL, findModel, isEnglishOnly, type Backend, type Dtype } from "./lib/models";
import type { FromWorker, ToWorker, TranscriptResult } from "./lib/protocol";
import { LANGUAGES } from "./lib/settings";
import { wordErrorRate, words } from "./lib/wer";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const audioInput = $<HTMLInputElement>("audio");
const refInput = $<HTMLInputElement>("ref");
const modelSel = $<HTMLSelectElement>("model");
const deviceSel = $<HTMLSelectElement>("device");
const dtypeSel = $<HTMLSelectElement>("dtype");
const langSel = $<HTMLSelectElement>("language");
const runsInput = $<HTMLInputElement>("runs");
const diarizeBox = $<HTMLInputElement>("diarize");
const runBtn = $<HTMLButtonElement>("run");
const copyBtn = $<HTMLButtonElement>("copy");
const status = $<HTMLDivElement>("status");
const tbody = $<HTMLTableSectionElement>("results");
const transcriptPre = $<HTMLPreElement>("transcript");

interface Row {
  model: string;
  dtype: Dtype;
  device: string;
  file: string;
  audioS: number;
  decodeS: number;
  loadS: number;
  transcribeS: number;
  diarizeS: number | null;
  wer: number | null;
  words: number;
  language: string;
}
const rows: Row[] = [];

// ── Settings form ─────────────────────────────────────────────────────────
for (const m of MODELS) modelSel.add(new Option(`${m.name} — ${m.group}`, m.id));
modelSel.value = "KBLab/kb-whisper-base";
for (const l of LANGUAGES) langSel.add(new Option(l.label, l.code ?? ""));
langSel.value = "sv";

function refreshDtypes() {
  const model = findModel(modelSel.value)!;
  const device = deviceSel.value as Backend;
  dtypeSel.replaceChildren(
    ...availableTiers(model, device).map(
      (t) => new Option(`${DTYPE_LABEL[t.dtype]} (${t.dtype})`, t.dtype),
    ),
  );
  dtypeSel.value = defaultDtype(model, device);
  langSel.disabled = isEnglishOnly(model.id);
}
modelSel.onchange = deviceSel.onchange = refreshDtypes;
if (!("gpu" in navigator)) deviceSel.value = "wasm";
refreshDtypes();

// ── Worker ────────────────────────────────────────────────────────────────
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let waiting: { resolve: (m: FromWorker) => void; reject: (e: Error) => void; types: FromWorker["type"][] } | null = null;

/** Message types seen, in order — shows where a stuck run stopped. */
const trace: string[] = [];
(window as unknown as { benchTrace: string[] }).benchTrace = trace;

worker.onerror = (e) => {
  waiting?.reject(new Error(`Worker crashed: ${e.message || "unknown error"}`));
  waiting = null;
};

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (trace.at(-1) !== msg.type) trace.push(msg.type);
  if (msg.type === "download" && msg.data.status === "progress" && msg.data.file) {
    phase(`Downloading ${msg.data.file} ${Math.round(msg.data.progress ?? 0)}%…`, "download");
  }
  if (msg.type === "ready") phase("Model ready…");
  if (msg.type === "transcribe-progress") phase(`Transcribing… ${Math.round(msg.progress * 100)}%`, "Transcribing…");
  if (msg.type === "diarize-progress") phase(`Separating speakers… ${Math.round(msg.progress * 100)}%`, "Separating speakers…");
  if (!waiting) return;
  if (msg.type === "error") {
    waiting.reject(new Error(msg.message));
    waiting = null;
  } else if (waiting.types.includes(msg.type)) {
    waiting.resolve(msg);
    waiting = null;
  }
};

function request(msg: ToWorker, types: FromWorker["type"][], transfer: Transferable[] = []) {
  return new Promise<FromWorker>((resolve, reject) => {
    waiting = { resolve, reject, types };
    worker.postMessage(msg, transfer);
  });
}

// ── Running ───────────────────────────────────────────────────────────────
const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** Show a phase with a running clock; progress updates keep the clock going. */
let ticker = 0;
let phaseName = "";
let phaseStart = 0;
let phaseLabel = "";
function phase(label: string, name = label) {
  if (name !== phaseName) {
    phaseName = name;
    phaseStart = performance.now();
  }
  phaseLabel = label;
  clearInterval(ticker);
  const show = () =>
    (status.textContent = `${phaseLabel} ${Math.round((performance.now() - phaseStart) / 1000)} s`);
  show();
  ticker = window.setInterval(show, 1000);
}

async function runOnce(file: File, reference: string | null) {
  const modelId = modelSel.value;
  const dtype = dtypeSel.value as Dtype;
  const device = deviceSel.value as Backend;
  const englishOnly = isEnglishOnly(modelId);

  phase("Decoding audio…");
  let t = performance.now();
  const audio = await decodeToPCM(file);
  const decodeS = seconds(performance.now() - t);
  // Measured now: sending the audio to the worker empties this buffer.
  const audioS = Math.round(durationOf(audio));

  phase("Loading model…");
  t = performance.now();
  // The worker may fall back from WebGPU to the CPU with a different quality;
  // its reply says what actually loaded.
  const ready = (await request({ type: "load", modelId, dtype, device }, ["ready"])) as {
    dtype: Dtype;
    device: Backend;
  };
  const loadS = seconds(performance.now() - t);

  const diarize = diarizeBox.checked;
  phase("Transcribing…");
  t = performance.now();
  const done = await request(
    {
      type: "transcribe",
      jobId: "bench",
      audio,
      language: englishOnly ? null : langSel.value || null,
      task: "transcribe",
      retainAudio: diarize,
    },
    ["result"],
    [audio.buffer],
  );
  const transcribeS = seconds(performance.now() - t);
  const result = (done as { result: TranscriptResult }).result;

  let diarizeS: number | null = null;
  if (diarize) {
    phase("Separating speakers…");
    t = performance.now();
    await request({ type: "diarize", jobId: "bench" }, ["diarize-result"]);
    diarizeS = seconds(performance.now() - t);
  }

  const row: Row = {
    model: findModel(modelId)!.name,
    dtype: ready.dtype,
    device: ready.device === device ? ready.device : `${ready.device} (fell back)`,
    file: file.name,
    audioS,
    decodeS,
    loadS,
    transcribeS,
    diarizeS,
    wer: reference ? wordErrorRate(reference, result.text) : null,
    words: words(result.text).length,
    // English-only models get no language token at all.
    language: englishOnly ? "en (model)" : (result.language ?? (langSel.value || "–")),
  };
  return { row, text: result.text };
}

runBtn.onclick = async () => {
  const file = audioInput.files?.[0];
  if (!file) {
    status.textContent = "Pick an audio file first.";
    return;
  }
  const reference = refInput.files?.[0] ? await refInput.files[0].text() : null;
  const runs = Math.max(1, Math.min(10, Number(runsInput.value) || 1));
  runBtn.disabled = true;
  try {
    for (let i = 0; i < runs; i++) {
      const { row, text } = await runOnce(file, reference);
      rows.push(row);
      render();
      transcriptPre.textContent = text.slice(0, 2000);
    }
    clearInterval(ticker);
    status.textContent = "Done.";
  } catch (err) {
    clearInterval(ticker);
    status.textContent = `Error: ${(err as Error).message}`;
  } finally {
    runBtn.disabled = false;
  }
};

// ── Output ────────────────────────────────────────────────────────────────
const fmt = (n: number | null, digits = 1) => (n == null ? "–" : n.toFixed(digits));
const speed = (r: Row) => (r.transcribeS > 0 ? r.audioS / r.transcribeS : 0);
const cells = (r: Row, i: number) => [
  String(i + 1), r.model, r.dtype, r.device, `${r.audioS} s`,
  fmt(r.decodeS), fmt(r.loadS), fmt(r.transcribeS), `${fmt(speed(r))}×`,
  fmt(r.diarizeS), r.wer == null ? "–" : `${(r.wer * 100).toFixed(1)}%`, String(r.words), r.language,
];

function render() {
  tbody.replaceChildren(
    ...rows.map((r, i) => {
      const tr = document.createElement("tr");
      for (const [j, c] of cells(r, i).entries()) {
        const td = document.createElement("td");
        td.textContent = c;
        if (j >= 4 && j <= 11) td.className = "num";
        tr.append(td);
      }
      return tr;
    }),
  );
}

async function environment(): Promise<string> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string>; info?: { vendor?: string; architecture?: string } } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  const chrome = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent;
  const gpuText = adapter
    ? `${adapter.info?.vendor ?? "?"} ${adapter.info?.architecture ?? ""}, shader-f16: ${adapter.features.has("shader-f16") ? "yes" : "no"}`
    : "none";
  return `${new Date().toISOString().slice(0, 10)} · ${chrome} · GPU: ${gpuText} · ${navigator.hardwareConcurrency} CPU threads`;
}

copyBtn.onclick = async () => {
  const head = ["#", "Model", "Quality", "Device", "Audio", "Decode s", "Load s", "Transcribe s", "× real time", "Speakers s", "WER", "Words", "Lang"];
  const md = [
    `Benchmark — ${await environment()}`,
    `File: ${rows[0]?.file ?? "–"}`,
    "",
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r, i) => `| ${cells(r, i).join(" | ")} |`),
  ].join("\n");
  await navigator.clipboard.writeText(md);
  status.textContent = "Copied.";
};
