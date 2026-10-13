// RateCon Radar page logic. Everything here runs in the browser tab.
import { LABEL_INFO, pdfItemsToText, extractAmounts, missingProtections, exposure, counterNote, moneyToNumber } from "./core.js";
import * as pdfjs from "./pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;

export const MODEL_CHOICES = [
  { key: "gemma4-e2b", name: "Gemma 4 E2B", size: "3.1 GB download", note: "Most accurate in testing. Apache 2.0 license. Needs a laptop or desktop GPU." },
  { key: "gemma3-1b", name: "Gemma 3 1B", size: "760 MB download", note: "Faster to download, but it missed more clauses in testing. Gemma license." },
  { key: "gemma3-270m", name: "Gemma 3 270M", size: "270 MB download", note: "Included for comparison. Too small for this job without fine-tuning." },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Worker. It is started from a blob URL on purpose: a blob worker inherits this
// page's Content Security Policy, so the model code is bound by the same network
// rules as the page.
// ---------------------------------------------------------------------------
export async function startWorker() {
  const base = new URL("./", import.meta.url).href;
  const src = (await (await fetch(new URL("./worker.js", import.meta.url))).text()).replaceAll("__BASE__", base);
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module" });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The model worker did not start.")), 60000);
    worker.addEventListener("message", function once(e) {
      if (e.data.type === "booted") { clearTimeout(t); worker.removeEventListener("message", once); resolve(); }
    });
    worker.addEventListener("error", (e) => { clearTimeout(t); reject(new Error(e.message || "Worker failed to start.")); });
  });
  return worker;
}

export async function pdfToText(arrayBuffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(pdfItemsToText(tc.items));
  }
  return pages.join("\n");
}

if (document.getElementById("modelSelect")) main();

async function main() {
  const state = { worker: null, ready: false, loading: null, busy: false, text: "", flags: [], facts: null, plan: null, pending: null };

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Model picker
  const sel = $("modelSelect");
  MODEL_CHOICES.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.key; o.textContent = `${m.name} (${m.size})`;
    sel.appendChild(o);
  });
  const params = new URLSearchParams(location.search);
  let saved = null;
  try { saved = localStorage.getItem("rr-model"); } catch {}
  sel.value = params.get("model") || saved || MODEL_CHOICES[0].key;
  if (!sel.value) sel.value = MODEL_CHOICES[0].key;
  const showHint = () => { $("modelHint").textContent = MODEL_CHOICES.find((m) => m.key === sel.value).note; };
  showHint();
  sel.addEventListener("change", () => {
    showHint();
    try { localStorage.setItem("rr-model", sel.value); } catch {}
    state.ready = false;
    $("loadBtn").disabled = false;
    $("loadBtn").textContent = "Load model";
    setStatus("Model changed. Load it to continue.");
  });

  function setStatus(msg, cls) { const s = $("modelStatus"); s.textContent = msg; s.className = "status" + (cls ? " " + cls : ""); }

  async function ensureWorker() {
    if (!state.worker) {
      state.worker = await startWorker();
      state.worker.addEventListener("message", onMessage);
    }
    return state.worker;
  }

  function loadModel() {
    if (state.ready) return Promise.resolve();
    if (state.loading) return state.loading;
    state.loading = new Promise(async (resolve, reject) => {
      state.loadResolve = resolve; state.loadReject = reject;
      try {
        $("loadBtn").disabled = true;
        $("loadProgress").hidden = false;
        setStatus("Starting. The first load downloads the model, later loads come from this browser's storage.");
        const w = await ensureWorker();
        w.postMessage({ type: "load", model: sel.value, device: params.get("device") || undefined });
      } catch (e) { reject(e); }
    }).catch((e) => {
      setStatus("Could not load the model: " + e.message, "bad");
      $("loadBtn").disabled = false;
      state.loading = null;
      throw e;
    });
    return state.loading;
  }
  $("loadBtn").addEventListener("click", () => loadModel().catch(() => {}));

  // Input
  const drop = $("drop");
  drop.addEventListener("click", () => $("file").click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  $("file").addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; });
  document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", async () => {
    const buf = await (await fetch(b.dataset.sample)).arrayBuffer();
    run(await pdfToText(buf), b.textContent.trim() + " (sample)");
  }));
  $("pasteToggle").addEventListener("click", () => { $("pasteBox").hidden = !$("pasteBox").hidden; });
  $("pasteGo").addEventListener("click", () => { const t = $("pasteText").value.trim(); if (t) run(t, "Pasted text"); });
  $("stopBtn").addEventListener("click", () => state.worker && state.worker.postMessage({ type: "cancel" }));

  async function handleFile(file) {
    try {
      let text;
      if (/\.txt$/i.test(file.name) || file.type === "text/plain") text = await file.text();
      else text = await pdfToText(await file.arrayBuffer());
      if (text.replace(/\s/g, "").length < 200) {
        showRunError("This PDF has almost no text in it. It is probably a scan or a photo. Scanned documents are not supported yet; paste the text instead.");
        return;
      }
      run(text, file.name);
    } catch (e) {
      showRunError("Could not read that file: " + e.message);
    }
  }

  function showRunError(msg) {
    $("results").hidden = false;
    $("runTitle").textContent = "Problem";
    $("runDetail").textContent = " " + msg;
  }

  async function run(text, title) {
    if (state.busy) return;
    state.busy = true;
    state.text = text; state.flags = []; state.facts = null; state.plan = null; state.title = title;
    $("results").hidden = false;
    $("flags").innerHTML = ""; $("facts").innerHTML = ""; $("risk").innerHTML = ""; $("missing").innerHTML = "";
    $("counter").hidden = true; $("noFlags").hidden = true; $("stats").textContent = ""; $("flagCount").textContent = "";
    $("factsNote").textContent = "";
    $("runBar").style.width = "0%";
    $("runTitle").textContent = title;
    $("runDetail").textContent = state.ready ? " Getting started." : " Loading the model first.";
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await loadModel();
      $("stopBtn").hidden = false;
      const limit = parseInt(params.get("limit") || "0", 10) || undefined;
      state.worker.postMessage({ type: "analyze", text, opts: { limit } });
    } catch (e) {
      state.busy = false;
      showRunError(e.message);
    }
  }

  function onMessage(e) {
    const m = e.data;
    if (m.type === "progress") {
      const pct = m.total ? (m.loaded / m.total) * 100 : 0;
      $("loadBar").style.width = pct.toFixed(1) + "%";
      setStatus(`Downloading model: ${(m.loaded / 1e6).toFixed(0)} of ${(m.total / 1e6).toFixed(0)} MB`);
    } else if (m.type === "ready") {
      state.ready = true; state.loading = null;
      $("loadProgress").hidden = true;
      $("loadBtn").textContent = "Model loaded";
      const where = m.device === "webgpu" ? "your GPU (WebGPU)" : "your CPU (WebAssembly, slower)";
      setStatus(`Ready. ${m.repo} is running on ${where}. Loaded in ${m.loadSeconds.toFixed(1)} s.`, "ok");
      state.loadResolve && state.loadResolve();
    } else if (m.type === "plan") {
      state.plan = m;
      $("runDetail").textContent = ` ${m.sentences} sentences found, ${m.toRead} worth a close read. Pulling out the load details.`;
    } else if (m.type === "facts") {
      state.facts = m.facts; renderFacts(); renderSide();
    } else if (m.type === "unit") {
      $("runBar").style.width = ((m.done / state.plan.toRead) * 100).toFixed(1) + "%";
      $("runDetail").textContent = ` Reading clause ${m.done} of ${state.plan.toRead}.`;
      if (m.label !== "NONE") addFlag(m);
    } else if (m.type === "done") {
      state.busy = false;
      $("stopBtn").hidden = true;
      $("runBar").style.width = "100%";
      $("runDetail").textContent = m.cancelled ? " Stopped early." : " Done.";
      if (!state.flags.length) $("noFlags").hidden = false;
      const d = m.model;
      $("stats").textContent = `${d.repo} · ${d.dtype} · ${d.device} · ${m.calls} model calls · ${m.outTokens} tokens written · ${m.seconds.toFixed(1)} s · 0 bytes of your document sent anywhere`;
      renderSide();
    } else if (m.type === "leak") {
      state.leakWorker && state.leakWorker(m);
    } else if (m.type === "error") {
      state.busy = false;
      $("stopBtn").hidden = true;
      if (m.during === "load") {
        state.loading = null; $("loadBtn").disabled = false; $("loadProgress").hidden = true;
        setStatus("Could not load the model: " + m.message, "bad");
        state.loadReject && state.loadReject(new Error(m.message));
      } else showRunError(m.message);
    }
  }

  function addFlag(m) {
    const last = state.flags[state.flags.length - 1];
    // Two flagged sentences in a row from the same paragraph and of the same kind are one clause.
    if (last && last.label === m.label && last.para === m.para && last.lastId === m.id - 1) {
      last.text += " " + m.text; last.lastId = m.id;
      if (m.meaning) last.meaning = (last.meaning ? last.meaning + " " : "") + m.meaning;
      last.el.replaceWith(last.el = flagEl(last));
    } else {
      const f = { id: m.id, lastId: m.id, para: m.para, label: m.label, text: m.text, meaning: m.meaning };
      f.el = flagEl(f);
      state.flags.push(f);
      // Keep the list ordered by how much the clause type tends to cost.
      const sorted = [...state.flags].sort((a, b) => (LABEL_INFO[b.label].weight - LABEL_INFO[a.label].weight) || (a.id - b.id));
      const idx = sorted.indexOf(f);
      const next = sorted[idx + 1];
      $("flags").insertBefore(f.el, next ? next.el : null);
    }
    $("flagCount").textContent = state.flags.length;
    renderSide();
  }

  function flagEl(f) {
    const amounts = extractAmounts(f.text).map((a) => a.percent !== undefined ? a.percent + "%" : money(a.value) + (a.perHour ? "/hr" : ""));
    const el = document.createElement("div");
    el.className = "flag"; el.dataset.label = f.label;
    el.innerHTML = `<div class="kind"><span>${esc(LABEL_INFO[f.label].name)}</span><span class="amt">${esc(amounts.join(" · "))}</span></div>
      <p class="meaning">${esc(f.meaning || "Read this clause carefully.")}</p>
      <blockquote>${esc(f.text)}</blockquote>`;
    return el;
  }

  function renderFacts() {
    const f = state.facts; if (!f) return;
    const rows = [["Broker", f.broker], ["Load #", f.load_number], ["Total pay", f.total_pay], ["Pickup", joinFact(f.pickup_city, f.pickup_date)], ["Delivery", joinFact(f.delivery_city, f.delivery_date)], ["Miles", f.miles]];
    const pay = moneyToNumber(f.total_pay.value), miles = moneyToNumber(f.miles.value);
    let html = rows.map(([k, v]) => `<dt>${k}</dt><dd class="${v.value && !v.verified ? "unverified" : ""}">${esc(v.value || "not found")}</dd>`).join("");
    if (pay && miles && f.total_pay.verified && f.miles.verified) html += `<dt>Per mile</dt><dd><b>$${(pay / miles).toFixed(2)}</b></dd>`;
    $("facts").innerHTML = html;
    const anyUnverified = rows.some(([, v]) => v.value && !v.verified);
    $("factsNote").textContent = anyUnverified ? "Values marked ? were written by the model but are not word for word in the document. Check them." : "Each value above was found word for word in your document.";
  }
  function joinFact(a, b) {
    const parts = [a.value, b.value].filter(Boolean);
    return { value: parts.join(", ") || null, verified: (!a.value || a.verified) && (!b.value || b.verified) };
  }

  function renderSide() {
    const flags = state.flags;
    const ex = exposure(flags);
    const counts = {};
    flags.forEach((f) => { counts[f.label] = (counts[f.label] || 0) + 1; });
    let html = "";
    if (ex.fixed || ex.hourly) {
      html += `<div class="bigmoney">${ex.fixed ? money(ex.fixed) : ""}${ex.fixed && ex.hourly ? " + " : ""}${ex.hourly ? money(ex.hourly) + "/hr" : ""}</div>
        <p class="hint">Dollar figures named in the penalty and deduction clauses, added up. It is a ceiling to keep in mind, not a prediction.</p>`;
    } else html += `<p class="hint">No dollar penalties found yet.</p>`;
    Object.keys(LABEL_INFO).forEach((k) => { if (counts[k]) html += `<div class="riskline"><span>${LABEL_INFO[k].name}</span><b>${counts[k]}</b></div>`; });
    $("risk").innerHTML = html;

    const missing = missingProtections(state.text, flags);
    const ul = $("missing");
    ul.innerHTML = missing.length ? missing.map((m) => `<li>${esc(m.text)}</li>`).join("") : `<li class="good">Detention, layover and TONU are all mentioned. Read their conditions on the right.</li>`;
    state.missing = missing;
    $("counter").hidden = !missing.length;
    updateCounter();
  }
  function updateCounter() {
    if (!state.missing) return;
    $("counterText").value = counterNote(state.facts, state.missing, { detention: +$("prefDet").value, freeHours: +$("prefFree").value, tonu: +$("prefTonu").value, layover: +$("prefLay").value });
  }
  ["prefDet", "prefFree", "prefTonu", "prefLay"].forEach((id) => $(id).addEventListener("input", updateCounter));
  $("copyCounter").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("counterText").value); $("copyCounter").textContent = "Copied"; }
    catch { $("counterText").select(); }
    setTimeout(() => { $("copyCounter").textContent = "Copy message"; }, 1500);
  });

  // Privacy test: both attempts should be refused by the browser.
  $("leakBtn").addEventListener("click", async () => {
    $("leakOut").textContent = "Testing.";
    const violation = new Promise((resolve) => {
      document.addEventListener("securitypolicyviolation", (e) => { if (String(e.blockedURI).includes("example.com")) resolve(true); });
      setTimeout(() => resolve(false), 2000);
    });
    let threw = false;
    try { await fetch("https://example.com/?ratecon-radar-privacy-test", { mode: "no-cors", cache: "no-store" }); } catch { threw = true; }
    const pageBlocked = threw && (await violation);
    let workerBlocked = null;
    try {
      const w = await ensureWorker();
      const r = await new Promise((resolve) => { state.leakWorker = resolve; w.postMessage({ type: "leaktest" }); setTimeout(() => resolve(null), 8000); });
      workerBlocked = r ? r.blocked : null;
    } catch { workerBlocked = null; }
    const ok = pageBlocked && workerBlocked === true;
    $("leakOut").textContent = ok
      ? "Passed. The browser refused an outside request from the page and from the model worker."
      : `Result: page ${pageBlocked ? "blocked" : "NOT blocked"}, worker ${workerBlocked === null ? "no answer" : workerBlocked ? "blocked" : "NOT blocked"}.`;
    $("leakOut").style.color = ok ? "var(--ok)" : "var(--bad)";
  });

  // Hooks for automated tests.
  window.__rr = { state, run, loadModel };
}
