// Pianissimo vs KB-Whisper, in the browser, on the FLEURS sv_se fixture.
// Every URL parameter mirrors a form field, so a run can be scripted:
//   /spike/pianissimo.html?engine=pianissimo&backend=wasm&quant=int8&threads=1&n=20&long=1&auto=1
import { decodeToPCM } from "../src/lib/audio";
import { sumCounts, werCounts, werOf, type WerCounts } from "./wer";
import type { FromSpike, RunConfig } from "./spike-worker";

interface Clip { file: string; reference: string; seconds: number }

interface RunResult {
  label: string;
  cfg: RunConfig;
  isolation: string;
  loadS: number;
  clips: number;
  clipAudioS: number;
  clipProcS: number;
  clipWer: WerCounts;
  longAudioS: number | null;
  longProcS: number | null;
  longWer: WerCounts | null;
  longChunks: number | null;
  memoryMB: number | null;
  hypotheses: string[];
  longText: string | null;
  error: string | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FIXTURE = "/spike-fixture";
const results: RunResult[] = JSON.parse(localStorage.getItem("spike-results") ?? "[]");
(window as unknown as { __spike: unknown }).__spike = { results, status: "idle" };

function log(text: string) {
  const el = $<HTMLPreElement>("log");
  el.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(s: string) {
  (window as unknown as { __spike: { status: string } }).__spike.status = s;
  $("status").textContent = s;
}

// Total memory for this page and its workers. Needs cross-origin isolation,
// which the dev server provides; returns null elsewhere.
async function measureMemoryMB(): Promise<number | null> {
  const p = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (!p.measureUserAgentSpecificMemory || !crossOriginIsolated) return null;
  try {
    return Math.round((await p.measureUserAgentSpecificMemory()).bytes / 1e6);
  } catch {
    return null;
  }
}

function readCfg(): RunConfig & { n: number; long: boolean } {
  const v = (id: string) => $<HTMLInputElement | HTMLSelectElement>(id).value;
  return {
    engine: v("engine") as RunConfig["engine"],
    backend: v("backend") as RunConfig["backend"],
    quant: v("quant"),
    decQuant: v("dec"),
    threads: parseInt(v("threads"), 10) || 0,
    whisperModel: v("whisperModel"),
    n: parseInt(v("n"), 10) || 0,
    long: $<HTMLInputElement>("long").checked,
  };
}

function labelOf(c: RunConfig): string {
  const t = c.threads ? `${c.threads}t` : "default threads";
  return c.engine === "pianissimo"
    ? `Pianissimo ${c.backend} enc-${c.quant} dec-${c.decQuant} (${t})`
    : `${c.whisperModel.split("/")[1]} ${c.backend} ${c.quant} (${t})`;
}

async function run() {
  const cfg = readCfg();
  const label = labelOf(cfg);
  setStatus(`running: ${label}`);
  $<HTMLButtonElement>("run").disabled = true;
  log(`▶ ${label}`);

  const index: Clip[] = await (await fetch(`${FIXTURE}/clips.json`)).json();
  const chosen = index.slice(0, cfg.n || index.length);
  const clips = await Promise.all(
    chosen.map(async (c) => decodeToPCM(await (await fetch(`${FIXTURE}/${c.file}`)).blob())),
  );
  const long = cfg.long ? await decodeToPCM(await (await fetch(`${FIXTURE}/long.wav`)).blob()) : null;
  const longRef = cfg.long ? await (await fetch(`${FIXTURE}/long.txt`)).text() : "";

  const r: RunResult = {
    label, cfg, isolation: "", loadS: 0,
    clips: clips.length,
    clipAudioS: chosen.reduce((s, c) => s + c.seconds, 0),
    clipProcS: 0, clipWer: sumCounts([]),
    longAudioS: long ? long.length / 16000 : null, longProcS: null, longWer: null, longChunks: null,
    memoryMB: null, hypotheses: [], longText: null, error: null,
  };
  const perClip: WerCounts[] = [];

  const worker = new Worker(new URL("./spike-worker.ts", import.meta.url), { type: "module" });
  const transfer = [...clips.map((c) => c.buffer), ...(long ? [long.buffer] : [])];
  await new Promise<void>((resolve) => {
    // A worker that crashes (e.g. out of memory) never posts again; keep the
    // clips that finished rather than losing the whole run.
    worker.onerror = (e) => {
      r.error = `worker crashed: ${e.message || "no message"}`;
      log(`✖ ${r.error}`);
      resolve();
    };
    // A GPU device loss can leave the worker silent but alive.
    let lastMsg = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMsg > 10 * 60_000) {
        r.error = "no progress for 10 min";
        log(`✖ ${r.error}`);
        clearInterval(watchdog);
        resolve();
      }
    }, 5000);
    worker.onmessage = async (e: MessageEvent<FromSpike>) => {
      lastMsg = Date.now();
      if (isFinal(e.data)) clearInterval(watchdog);
      const m = e.data;
      if (m.type === "log") log(m.text);
      if (m.type === "loaded") {
        r.loadS = m.ms / 1000;
        r.isolation = m.detail;
        log(`loaded in ${r.loadS.toFixed(1)} s (${m.detail})`);
        r.memoryMB = await measureMemoryMB();
      }
      if (m.type === "clip") {
        r.clipProcS += m.ms / 1000;
        r.hypotheses.push(m.text);
        perClip.push(werCounts(chosen[m.i].reference, m.text));
        if (m.i % 10 === 0 || m.i === clips.length - 1)
          log(`clip ${m.i + 1}/${clips.length}  ${(m.ms / 1000).toFixed(2)} s  "${m.text.slice(0, 70)}"`);
      }
      if (m.type === "long") {
        r.longProcS = m.ms / 1000;
        r.longText = m.text;
        r.longChunks = m.chunks;
        r.longWer = werCounts(longRef, m.text);
        log(`long file: ${r.longProcS.toFixed(1)} s, ${m.chunks} chunks`);
      }
      if (m.type === "error") { r.error = m.message; log(`✖ ${m.message}`); resolve(); }
      if (m.type === "done") {
        const after = await measureMemoryMB();
        if (after != null) r.memoryMB = Math.max(r.memoryMB ?? 0, after);
        resolve();
      }
    };
    worker.postMessage({ cfg, clips, long }, transfer);
  });
  worker.terminate();

  r.clipWer = sumCounts(perClip);
  results.push(r);
  localStorage.setItem("spike-results", JSON.stringify(results));
  render();
  setStatus(r.error ? `error: ${label}` : `done: ${label}`);
  $<HTMLButtonElement>("run").disabled = false;
}

function isFinal(m: FromSpike) {
  return m.type === "done" || m.type === "error";
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const speed = (audio: number, proc: number) => (proc ? `${(audio / proc).toFixed(1)}×` : "–");

function render() {
  const rows = results.map((r) => {
    const sd = r.clipWer.refWords ? (r.clipWer.sub + r.clipWer.del) / r.clipWer.refWords : 0;
    return `<tr${r.error ? ' class="err"' : ""}>
      <td>${r.label}<br><small>${r.isolation}</small></td>
      <td>${r.loadS.toFixed(1)} s</td>
      <td>${r.clips} / ${(r.clipAudioS / 60).toFixed(1)} min</td>
      <td>${speed(r.clipAudioS, r.clipProcS)}</td>
      <td>${pct(werOf(r.clipWer))}<br><small>sub+del ${pct(sd)}</small></td>
      <td>${r.longProcS != null ? speed(r.longAudioS!, r.longProcS) : "–"}</td>
      <td>${r.longWer ? pct(werOf(r.longWer)) : "–"}</td>
      <td>${r.memoryMB ?? "–"}</td>
      <td>${r.error ? r.error.split("\n")[0] : ""}</td></tr>`;
  });
  $("results").innerHTML = rows.join("");
}

function applyParams() {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of q) {
    const el = document.getElementById(k) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = v === "1";
    else el.value = v;
  }
  return q.get("auto") === "1";
}

$("run").addEventListener("click", () => void run());
$("clear").addEventListener("click", () => {
  results.length = 0;
  localStorage.removeItem("spike-results");
  render();
});
$("copy").addEventListener("click", () =>
  navigator.clipboard.writeText(JSON.stringify(results, null, 1)));
render();
if (applyParams()) void run();
