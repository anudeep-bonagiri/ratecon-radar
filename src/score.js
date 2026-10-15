// Scoring used by both the Node evaluation (scripts/eval-score.mjs) and the in-browser
// benchmark page (bench.html), so both report numbers computed the same way.
import { normalize, moneyToNumber, passesGate, keywordJudge } from "./core.js";

// Attach the ground-truth label to each unit by finding which labeled block of
// the source document contains the unit's text.
export function attachGold(units, doc) {
  const blocks = doc.terms.map((t, i) => ({ i, text: normalize(t.t), y: t.y }));
  for (const u of units) {
    const ut = normalize(u.text);
    const b = blocks.find((b) => b.text.includes(ut) || (ut.length > 30 && b.text.includes(ut.slice(0, Math.floor(ut.length * 0.8)))));
    u.block = b ? b.i : -1;
    u.gold = b ? b.y : null;
  }
  return units;
}

// A clause (block) counts as flagged if any of its sentences got a label other
// than NONE. Flags on text outside the terms (headers, stops) are false alarms.
export function scoreFlags(docs, DOCS, split, pick) {
  let tp = 0, fp = 0, fn = 0, typeOk = 0, goldBlocks = 0;
  const misses = [], falseAlarms = [];
  for (const d of docs) {
    const meta = DOCS.find((x) => x.id === d.id);
    if (!meta || (split !== "all" && meta.split !== split)) continue;
    const byBlock = new Map();
    for (const r of d.rows) {
      const label = pick(r);
      if (r.block < 0) { if (label !== "NONE") { fp++; falseAlarms.push(`${d.id}: [${label}] ${r.text}`); } continue; }
      if (!byBlock.has(r.block)) byBlock.set(r.block, []);
      byBlock.get(r.block).push(label);
    }
    meta.terms.forEach((t, i) => {
      const labels = (byBlock.get(i) || []).filter((l) => l !== "NONE");
      const flagged = labels.length > 0;
      if (t.y) {
        goldBlocks++;
        if (flagged) { tp++; if (labels.includes(t.y)) typeOk++; }
        else { fn++; misses.push(`${d.id}: [${t.y}] ${t.t}`); }
      } else if (flagged) { fp++; falseAlarms.push(`${d.id}: [${labels[0]}] ${t.t}`); }
    });
  }
  const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1);
  const r3 = (x) => +x.toFixed(3);
  return { goldBlocks, tp, fp, fn, precision: r3(precision), recall: r3(recall), f1: r3(2 * precision * recall / (precision + recall || 1)), typeAcc: r3(typeOk / (tp || 1)), misses, falseAlarms };
}

export function scoreFacts(docs, DOCS, split) {
  let ok = 0, total = 0, wrongVerified = 0, wrongUnverified = 0;
  const errors = [];
  const clean = (s) => normalize(String(s)).toLowerCase().replace(/[.,]/g, "");
  for (const d of docs) {
    const meta = DOCS.find((x) => x.id === d.id);
    if (!meta || (split !== "all" && meta.split !== split) || !d.facts) continue;
    const g = meta.facts, f = d.facts;
    const checks = {
      broker: (v) => v && clean(v) === clean(g.broker),
      load_number: (v) => v && v.replace(/[^A-Za-z0-9]/g, "") === g.load_number.replace(/[^A-Za-z0-9]/g, ""),
      total_pay: (v) => moneyToNumber(v) === g.rate_total,
      pickup_city: (v) => v && v.toLowerCase().includes(g.pickup_city.split(",")[0].toLowerCase()),
      pickup_date: (v) => v && v.includes(g.pickup_date),
      delivery_city: (v) => v && v.toLowerCase().includes(g.delivery_city.split(",")[0].toLowerCase()),
      delivery_date: (v) => v && v.includes(g.delivery_date),
      miles: (v) => moneyToNumber(v) === g.miles,
    };
    for (const k of Object.keys(checks)) {
      total++;
      const v = f[k] ? f[k].value : null;
      if (checks[k](v)) ok++;
      else { errors.push(`${d.id}.${k}: got ${JSON.stringify(v)} verified=${f[k] && f[k].verified}`); if (f[k] && f[k].verified) wrongVerified++; else wrongUnverified++; }
    }
  }
  return { ok, total, acc: +(ok / (total || 1)).toFixed(3), wrongVerified, wrongUnverified, errors };
}

export const baselinePick = (row) => (passesGate(row.text) ? keywordJudge(row.text).label : "NONE");
export const gateOnlyPick = (row) => (passesGate(row.text) ? "DEDUCTION" : "NONE");
