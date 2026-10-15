// Scores saved model outputs against the labels in eval/docs.mjs.
// Usage: node scripts/eval-score.mjs [dev|test|all] file1.json file2.json ...
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const at = (p) => fileURLToPath(new URL(p, new URL("../", import.meta.url))); // path from the repo root
import { DOCS } from "../eval/docs.mjs";
import { scoreFlags, scoreFacts, baselinePick, gateOnlyPick } from "../src/score.js";

const split = process.argv[2] || "test";
const files = process.argv.slice(3);
const summary = {};
let first = null;
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!first) first = r;
  summary[`${r.model} (${r.dtype}, ${r.runtime})`] = { seconds: r.seconds, judgeCalls: r.judgeCalls, flags: scoreFlags(r.docs, DOCS, split, (row) => row.label), facts: scoreFacts(r.docs, DOCS, split) };
}
if (first) {
  summary["keyword rules (no model)"] = { flags: scoreFlags(first.docs, DOCS, split, baselinePick) };
  summary["flag everything the gate passes"] = { flags: scoreFlags(first.docs, DOCS, split, gateOnlyPick) };
}
const verbose = process.env.VERBOSE;
for (const [k, v] of Object.entries(summary)) {
  const { misses, falseAlarms, ...flags } = v.flags;
  console.log("\n==", k, v.seconds ? `(${Math.round(v.seconds)}s, ${v.judgeCalls} calls)` : "");
  console.log("flags", JSON.stringify(flags));
  if (v.facts) { const { errors, ...ff } = v.facts; console.log("facts", JSON.stringify(ff)); if (verbose) console.log(errors.join("\n")); }
  if (verbose) { console.log("MISSES\n" + misses.join("\n")); console.log("FALSE ALARMS\n" + falseAlarms.join("\n")); }
}
fs.writeFileSync(at(`eval/results/eval-summary-${split}.json`), JSON.stringify(summary, null, 1));
