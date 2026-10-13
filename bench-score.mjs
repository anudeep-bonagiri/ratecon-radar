// Scores bench-results.json (saved from bench.html) with the same scoring code.
// Usage: node bench-score.mjs [test|dev|all]
import fs from "node:fs";
import { DOCS } from "./eval-docs.mjs";
import { scoreFlags, scoreFacts, baselinePick, gateOnlyPick } from "./score.js";
const split = process.argv[2] || "test";
const all = JSON.parse(fs.readFileSync("bench-results.json", "utf8"));
const verbose = process.env.VERBOSE;
let first = null;
const out = {};
for (const [key, r] of Object.entries(all)) {
  first = first || r;
  const flags = scoreFlags(r.docs, DOCS, split, (x) => x.label);
  const facts = scoreFacts(r.docs, DOCS, split);
  const docs = r.docs.filter((d) => split === "all" || d.split === split);
  const secs = docs.reduce((a, d) => a + d.seconds, 0), calls = docs.reduce((a, d) => a + d.calls, 0), toks = docs.reduce((a, d) => a + d.outTokens, 0);
  out[key] = { model: r.model, dtype: r.dtype, runtime: r.runtime, docs: docs.length, seconds: +secs.toFixed(1), secondsPerDoc: +(secs / docs.length).toFixed(1), calls, secondsPerCall: +(secs / calls).toFixed(2), outTokens: toks, flags, facts };
}
out.keywords = { flags: scoreFlags(first.docs, DOCS, split, baselinePick) };
out.gateOnly = { flags: scoreFlags(first.docs, DOCS, split, gateOnlyPick) };
for (const [k, v] of Object.entries(out)) {
  const { misses, falseAlarms, ...f } = v.flags;
  console.log("\n==", k, v.model || "", v.seconds ? `${v.seconds}s total, ${v.secondsPerDoc}s/doc, ${v.secondsPerCall}s/call` : "");
  console.log("flags", JSON.stringify(f));
  if (v.facts) { const { errors, ...ff } = v.facts; console.log("facts", JSON.stringify(ff)); if (verbose) console.log(errors.join("\n")); }
  if (verbose) { console.log("MISSES\n" + misses.join("\n")); console.log("FALSE ALARMS\n" + falseAlarms.join("\n")); }
}
fs.writeFileSync(`bench-summary-${split}.json`, JSON.stringify(out, null, 1));
