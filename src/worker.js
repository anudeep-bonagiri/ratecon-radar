// Model worker. Loads an open-weight Gemma model with Transformers.js and runs it
// on WebGPU (or WebAssembly when there is no GPU). The page starts this file from
// a blob URL so that it inherits the page's Content Security Policy.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
import { toUnits, passesGate, judgeMessages, parseJudge, factsMessages, parseFacts } from "__BASE__core.js";

env.allowLocalModels = false;

export const MODELS = {
  // gpu: weights used on WebGPU. cpu: weights used on WebAssembly, or null when
  // the model is too large to be usable without a GPU.
  "gemma4-e2b": { repo: "onnx-community/gemma-4-E2B-it-ONNX", gpu: "q4f16", cpu: null },
  "gemma3-1b": { repo: "onnx-community/gemma-3-1b-it-ONNX-GQA", gpu: "q4f16", cpu: "int8" },
  "gemma3-270m": { repo: "onnx-community/gemma-3-270m-it-ONNX", gpu: "q4f16", cpu: "q8" },
};

let gen = null;
let loaded = null;
let cancel = false;

async function pickDevice() {
  try {
    if (!self.navigator.gpu) return { device: "wasm", f16: false };
    const adapter = await self.navigator.gpu.requestAdapter();
    if (!adapter) return { device: "wasm", f16: false };
    return { device: "webgpu", f16: adapter.features.has("shader-f16") };
  } catch {
    return { device: "wasm", f16: false };
  }
}

async function load(key, forceDevice) {
  const m = MODELS[key];
  if (!m) throw new Error("Unknown model " + key);
  const picked = await pickDevice();
  const device = forceDevice || picked.device;
  const dtype = device === "webgpu" ? (picked.f16 ? m.gpu : "q4") : m.cpu;
  if (!dtype) throw new Error("This model needs WebGPU, and this browser did not offer a GPU. Try Chrome or Edge on a laptop or desktop, or pick a smaller model.");
  const files = new Map();
  if (gen && gen.dispose) { try { await gen.dispose(); } catch {} }
  gen = null;
  const t0 = performance.now();
  gen = await pipeline("text-generation", m.repo, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0;
        for (const [a, b] of files.values()) { l += a; t += b; }
        self.postMessage({ type: "progress", loaded: l, total: t });
      }
    },
  });
  loaded = { key, repo: m.repo, device, dtype, loadSeconds: (performance.now() - t0) / 1000 };
  self.postMessage({ type: "ready", ...loaded });
}

async function ask(messages, max_new_tokens) {
  const out = await gen(messages, { max_new_tokens, do_sample: false });
  return out[0].generated_text.at(-1).content;
}

function countTokens(text) {
  try { return gen.tokenizer.encode(text).length; } catch { return 0; }
}

async function analyze(text, opts) {
  cancel = false;
  const units = toUnits(text);
  const todo = units.filter((u) => passesGate(u.text));
  const limit = opts && opts.limit ? opts.limit : todo.length;
  self.postMessage({ type: "plan", sentences: units.length, toRead: Math.min(limit, todo.length), units: opts && opts.returnUnits ? units : undefined });
  const t0 = performance.now();
  let outTokens = 0;

  const rawFacts = await ask(factsMessages(text), 320);
  outTokens += countTokens(rawFacts);
  self.postMessage({ type: "facts", facts: parseFacts(rawFacts, text), raw: rawFacts });

  let done = 0;
  for (const u of todo.slice(0, limit)) {
    if (cancel) break;
    const raw = await ask(judgeMessages(u), 48);
    outTokens += countTokens(raw);
    const { label, meaning } = parseJudge(raw);
    done++;
    self.postMessage({ type: "unit", id: u.id, para: u.para, text: u.text, label, meaning, raw, done });
  }
  const seconds = (performance.now() - t0) / 1000;
  self.postMessage({ type: "done", cancelled: cancel, seconds, calls: done + 1, outTokens, model: loaded });
}

// Used by the "privacy test" button: try to reach a server that the page's
// Content Security Policy does not allow. The test only passes if the browser
// reports a policy violation, so being offline cannot fake a pass.
async function leakTest() {
  const violation = new Promise((resolve) => {
    self.addEventListener("securitypolicyviolation", (e) => { if (String(e.blockedURI).includes("example.com")) resolve(true); });
    setTimeout(() => resolve(false), 2000);
  });
  let threw = false;
  try { await fetch("https://example.com/?ratecon-radar-privacy-test", { mode: "no-cors", cache: "no-store" }); } catch { threw = true; }
  return { blocked: threw && (await violation) };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "load") await load(msg.model, msg.device);
    else if (msg.type === "analyze") await analyze(msg.text, msg.opts);
    else if (msg.type === "cancel") cancel = true;
    else if (msg.type === "leaktest") self.postMessage({ type: "leak", ...(await leakTest()) });
  } catch (err) {
    self.postMessage({ type: "error", during: msg.type, message: String(err && err.message || err) });
  }
};
self.postMessage({ type: "booted" });
