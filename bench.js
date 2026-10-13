// In-browser benchmark. Same documents, same prompts and same scoring as the
// Node evaluation, but the model runs on WebGPU exactly as it does in the app.
import { startWorker, pdfToText, MODEL_CHOICES } from "./app.js";
import { toUnits } from "./core.js";
import { attachGold, scoreFlags, scoreFacts, baselinePick } from "./score.js";
import { DOCS } from "./eval-docs.mjs";

const $ = (id) => document.getElementById(id);
const log = (s) => { $("bLog").textContent += s + "\n"; $("bLog").scrollTop = 1e9; };
const all = {}; // model key -> results
window.__bench = { all, done: false, running: false };

MODEL_CHOICES.forEach((m) => { const o = document.createElement("option"); o.value = m.key; o.textContent = `${m.name} (${m.size})`; $("bModel").appendChild(o); });
const qs = new URLSearchParams(location.search);
if (qs.get("model")) $("bModel").value = qs.get("model");
if (qs.get("split")) $("bSplit").value = qs.get("split");

let worker = null;
function once(type) {
  return new Promise((resolve, reject) => {
    const h = (e) => {
      if (e.data.type === type) { worker.removeEventListener("message", h); resolve(e.data); }
      else if (e.data.type === "error") { worker.removeEventListener("message", h); reject(new Error(e.data.message)); }
    };
    worker.addEventListener("message", h);
  });
}

async function runModel(key, split) {
  window.__bench.running = true; window.__bench.done = false; window.__bench.error = null;
  $("bRun").disabled = true;
  try {
    if (!worker) worker = await startWorker();
    const onProgress = (e) => { if (e.data.type === "progress") $("bStatus").textContent = `Downloading ${(e.data.loaded / 1e6).toFixed(0)} of ${(e.data.total / 1e6).toFixed(0)} MB`; };
    worker.addEventListener("message", onProgress);
    const ready = once("ready");
    worker.postMessage({ type: "load", model: key });
    const info = await ready;
    worker.removeEventListener("message", onProgress);
    log(`loaded ${info.repo} ${info.dtype} on ${info.device} in ${info.loadSeconds.toFixed(1)} s`);
    const res = { model: info.repo, dtype: info.dtype, runtime: `browser/${info.device}`, userAgent: navigator.userAgent, docs: [], seconds: 0, judgeCalls: 0, outTokens: 0 };
    const docs = DOCS.filter((d) => split === "all" || d.split === split);
    let n = 0;
    for (const doc of docs) {
      $("bStatus").textContent = `${info.repo}: document ${n + 1} of ${docs.length} (${doc.id})`;
      const text = await pdfToText(await (await fetch(`sample-${doc.id}.pdf`)).arrayBuffer());
      const units = attachGold(toUnits(text), doc);
      const rows = units.map((u) => ({ text: u.text, block: u.block, gold: u.gold, gated: false, label: "NONE" }));
      let facts = null, rawFacts = "";
      const collect = (e) => {
        const m = e.data;
        if (m.type === "facts") { facts = m.facts; rawFacts = m.raw; }
        if (m.type === "unit") Object.assign(rows[m.id], { gated: true, raw: m.raw, label: m.label, meaning: m.meaning });
      };
      worker.addEventListener("message", collect);
      const done = once("done");
      worker.postMessage({ type: "analyze", text });
      const d = await done;
      worker.removeEventListener("message", collect);
      res.docs.push({ id: doc.id, split: doc.split, rows, rawFacts, facts, seconds: d.seconds, calls: d.calls, outTokens: d.outTokens });
      res.seconds += d.seconds; res.judgeCalls += d.calls - 1; res.outTokens += d.outTokens;
      log(`${doc.id}: ${d.calls} calls, ${d.seconds.toFixed(1)} s, ${d.outTokens} tokens out`);
      n++;
      $("bBar").style.width = ((n / docs.length) * 100).toFixed(0) + "%";
    }
    all[key] = res;
    render();
    $("bStatus").textContent = `Finished ${info.repo}: ${res.seconds.toFixed(1)} s for ${docs.length} documents.`;
  } catch (e) {
    window.__bench.error = String(e.message || e);
    $("bStatus").textContent = "Failed: " + window.__bench.error;
    log("ERROR " + window.__bench.error);
  }
  $("bRun").disabled = false;
  window.__bench.running = false; window.__bench.done = true;
}

function render() {
  const tb = $("bTable").querySelector("tbody");
  tb.innerHTML = "";
  const pct = (x) => (x * 100).toFixed(0) + "%";
  const row = (name, f, facts, secs) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${f.tp} of ${f.goldBlocks}</td><td>${f.fp}</td><td>${pct(f.precision)}</td><td>${pct(f.recall)}</td><td>${f.f1.toFixed(2)}</td><td>${pct(f.typeAcc)}</td><td>${facts ? `${facts.ok} of ${facts.total}` : "n/a"}</td><td>${secs ? secs.toFixed(0) + " s" : "instant"}</td>`;
    tb.appendChild(tr);
  };
  let first = null;
  for (const [key, r] of Object.entries(all)) {
    first = first || r;
    const testSecs = r.docs.filter((d) => d.split === "test").reduce((a, d) => a + d.seconds, 0);
    row(`${r.model} (${r.dtype}, ${r.runtime})`, scoreFlags(r.docs, DOCS, "test", (x) => x.label), scoreFacts(r.docs, DOCS, "test"), testSecs);
  }
  if (first) row("Keyword rules, no model", scoreFlags(first.docs, DOCS, "test", baselinePick), null, 0);
  const json = JSON.stringify(all);
  $("bDownload").href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  window.__bench.json = json;
}

$("bRun").addEventListener("click", () => runModel($("bModel").value, $("bSplit").value));
$("bCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(JSON.stringify(all)); $("bCopy").textContent = "Copied"; } catch {} });
if (qs.get("autorun")) runModel($("bModel").value, $("bSplit").value);
