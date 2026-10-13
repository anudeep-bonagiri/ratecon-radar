// Runs a model over the synthetic rate confirmations and saves raw outputs.
// Usage: node eval-run.mjs <hf-model-id> <dtype> [dev|test|all]
import fs from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { loadDoc, DOCS } from "./eval-lib.mjs";
import { passesGate, judgeMessages, parseJudge, factsMessages, parseFacts } from "./core.js";

const modelId = process.argv[2] || "onnx-community/gemma-3-270m-it-ONNX";
const dtype = process.argv[3] || "q4";
const split = process.argv[4] || "all";
const tag = modelId.split("/").pop().replace(/-ONNX.*/, "");

const gen = await pipeline("text-generation", modelId, { dtype });
async function ask(messages, max_new_tokens) {
  const out = await gen(messages, { max_new_tokens, do_sample: false });
  return out[0].generated_text.at(-1).content;
}

const results = { model: modelId, dtype, runtime: "node/onnxruntime CPU", docs: [] };
const t0 = Date.now();
let calls = 0;
for (const doc of DOCS) {
  if (split !== "all" && doc.split !== split) continue;
  const { text, units } = await loadDoc(doc);
  const rows = [];
  for (const u of units) {
    if (!passesGate(u.text)) { rows.push({ text: u.text, block: u.block, gold: u.gold, gated: false, label: "NONE" }); continue; }
    const raw = await ask(judgeMessages(u), 48);
    calls++;
    const { label, meaning } = parseJudge(raw);
    rows.push({ text: u.text, block: u.block, gold: u.gold, gated: true, raw, label, meaning });
  }
  const rawFacts = await ask(factsMessages(text), 320);
  const facts = parseFacts(rawFacts, text);
  results.docs.push({ id: doc.id, split: doc.split, rows, rawFacts, facts });
  console.log(doc.id, "done", ((Date.now() - t0) / 1000).toFixed(0) + "s");
  fs.writeFileSync(`eval-raw-${tag}.json`, JSON.stringify(results, null, 1));
}
results.seconds = (Date.now() - t0) / 1000;
results.judgeCalls = calls;
fs.writeFileSync(`eval-raw-${tag}.json`, JSON.stringify(results, null, 1));
console.log("total s", results.seconds, "calls", calls);
