// Reports how accurate the model's plain-English lines were (from hand grades)
// and how many of the wrong ones the meaningWarning() guard catches.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const at = (p) => fileURLToPath(new URL(p, new URL("../", import.meta.url))); // path from the repo root
import { meaningWarning } from "../src/core.js";
import { WRONG } from "../eval/meaning-grades.mjs";
const r = JSON.parse(fs.readFileSync(at("eval/results/bench-results.json"), "utf8"))["gemma4-e2b"];
let total = 0, wrong = 0, caught = 0, falseWarn = 0;
const byKind = {};
const used = new Set();
for (const d of r.docs) {
  if (d.split !== "test") continue;
  for (const x of d.rows) {
    if (x.label === "NONE") continue;
    total++;
    const g = WRONG.find((w) => w.doc === d.id && x.text.startsWith(w.starts));
    const warn = meaningWarning(x.text, x.meaning);
    if (g) { wrong++; used.add(g); byKind[g.kind] = (byKind[g.kind] || 0) + 1; if (warn) caught++; else console.log("not caught:", d.id, "|", x.meaning); }
    else if (warn) { falseWarn++; console.log("false warning:", d.id, "|", x.text.slice(0, 80), "|", x.meaning, "|", warn); }
  }
}
if (used.size !== WRONG.length) console.log("UNMATCHED GRADES", WRONG.filter((w) => !used.has(w)));
console.log(JSON.stringify({ linesRead: total, accurate: total - wrong, wrong, byKind, guardCaught: caught, guardFalseWarnings: falseWarn }));
