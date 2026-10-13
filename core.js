// RateCon Radar core logic. No DOM and no model code in this file, so the same
// functions run in the browser, in the worker, and in the Node evaluation script.

export const LABELS = ["ARRIVAL", "TRACKING", "ACCESSORIAL", "PAPERWORK", "PAYMENT", "DEDUCTION", "LIABILITY"];

export const LABEL_INFO = {
  ARRIVAL: { name: "Late or early arrival", weight: 5 },
  TRACKING: { name: "Tracking and check calls", weight: 4 },
  DEDUCTION: { name: "Charges and deductions", weight: 4 },
  PAPERWORK: { name: "Paperwork deadline", weight: 3 },
  ACCESSORIAL: { name: "Detention, layover, TONU", weight: 3 },
  LIABILITY: { name: "Cargo liability", weight: 2 },
  PAYMENT: { name: "Payment terms", weight: 1 },
};

// ---------------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------------

const ABBREV = ["No", "Nos", "St", "Ste", "Inc", "Co", "Corp", "Ltd", "Dr", "Rd", "Ave", "Blvd", "Hwy", "Mr", "Ms", "Mrs", "Jr", "Sr", "vs", "etc", "approx", "appt", "Appt", "ref", "Ref", "ext", "Ext", "lbs", "mi", "hr", "hrs", "min", "U.S", "a.m", "p.m", "e.g", "i.e"];

export function normalize(s) {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// Split one paragraph into sentences without breaking on abbreviations,
// decimals, or single initials such as "J. Driver".
export function splitSentences(paragraph) {
  const text = normalize(paragraph);
  const out = [];
  let start = 0;
  const re = /[.!?;](?=\s+["'(]?[A-Z0-9$])/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + 1;
    const before = text.slice(start, m.index);
    const lastWord = (before.match(/([A-Za-z.]+)$/) || [])[1] || "";
    if (text[m.index] === ".") {
      if (ABBREV.includes(lastWord)) continue;
      if (/^[A-Z]$/.test(lastWord)) continue; // initial
      if (/\d$/.test(before) && /^\s+\d/.test(text.slice(end)) && before.split(" ").length < 3) continue; // "1. " list marker
    }
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// Turn raw document text (paragraphs separated by newlines) into the units the
// model judges. A unit is one sentence plus the sentence before it as context.
export function toUnits(docText) {
  const paragraphs = docText.split(/\n+/).map(normalize).filter(Boolean);
  const units = [];
  paragraphs.forEach((p, pi) => {
    const cleaned = p.replace(/^\(?\d{1,2}[.)]\s+/, "");
    const sentences = splitSentences(cleaned);
    sentences.forEach((s, si) => {
      units.push({ id: units.length, para: pi, text: s, context: si > 0 ? sentences[si - 1] : "" });
    });
  });
  return units;
}

// ---------------------------------------------------------------------------
// Cheap gate: is this sentence worth showing to the model at all?
// Tuned for recall. It only removes text that cannot be a money term.
// ---------------------------------------------------------------------------

const GATE = /\$|%|\b(fee|fees|fine|fines|fined|charg\w*|deduct\w*|penal\w*|forfeit\w*|withh\w*|reduc\w*|drop\w*|liab\w*|responsib\w*|claim\w*|paid|pay|pays|payment\w*|remit\w*|settle\w*|detention|layover|tonu|not used|cancel\w*|lumper\w*|unload\w*|track\w*|check call\w*|update\w*|visib\w*|late|early|ahead|appointment\w*|miss\w*|invoice\w*|pod|proof of delivery|paperwork|document\w*|receipt\w*|offset|set off|setoff|broker\w*|assign\w*|factor\w*|waive\w*|void\w*|refus\w*|reject\w*|all[- ]in|includ\w*|inclusive|reimburs\w*|expense|cost\w*|bill\w*|wait\w*|delay\w*|free time|net \d+|discount\w*|subcontract\w*|shortage\w*|damage\w*|loss|standby|chargeback\w*|non-?compliance|no-?show)\b/i;

export function passesGate(text) {
  if (text.split(/\s+/).length < 5) return false;
  return GATE.test(text);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const JUDGE_HEAD = `You help a truck driver read a freight broker's rate confirmation before signing it.
Read the CLAUSE and pick the one label that fits.

ARRIVAL = money lost for arriving late, arriving early, or missing an appointment
TRACKING = money lost over tracking apps, check calls, or status updates
ACCESSORIAL = how detention, wait time, layover, or a cancelled truck (TONU) is paid, or that it is not paid
PAPERWORK = a deadline for the POD, BOL, or invoice that carries a fee, a delay, or non-payment
PAYMENT = when the carrier is paid, quick pay fees, factoring or assignment rules
DEDUCTION = other charges, lumper or unloading costs, chargebacks, offsets, all-in rates, losing pay for re-brokering
LIABILITY = cargo damage, shortages, claims, or risk placed on the carrier
NONE = instructions, contacts, addresses, equipment or insurance requirements, the rate amount, greetings, and any rule that names no fee, pay cut, deadline, or liability

Reply on one line as: LABEL | what it means for the driver in plain words, under 20 words.
If the label is NONE reply with only: NONE`;

// Few-shot examples. None of these sentences appear in the evaluation documents.
const JUDGE_SHOTS = [
  ["A fee of $200 per hour applies when the driver shows up past the appointment.", "ARRIVAL | You pay $200 for every hour you are late."],
  ["Driver should call the receiver for directions.", "NONE"],
  ["Loads that are not visible in the tracking app will have $100 removed from the rate.", "TRACKING | If tracking is off, you lose $100."],
  ["Detention of $50/hr starts after 2 hours and needs broker approval first.", "ACCESSORIAL | Waiting pays $50 an hour after 2 hours, but only if the broker approves it first."],
  ["Carrier is required to have $100,000 in cargo coverage.", "NONE"],
  ["Driver must keep the tracking app turned on for the whole trip.", "NONE"],
  ["We pay in 30 days; quick pay costs 3%.", "PAYMENT | You are paid in 30 days, or sooner if you give up 3%."],
  ["POD is due in 48 hours or a $75 fee is taken.", "PAPERWORK | Send the POD within 48 hours or lose $75."],
  ["Pickup number is 44021 and the dock opens at 6 am.", "NONE"],
  ["Broker may subtract any fine from money owed on other loads.", "DEDUCTION | The broker can take fines out of your pay on other loads."],
  ["Carrier is responsible for all damage to the freight until it is delivered.", "LIABILITY | Any damage before delivery is on you."],
];

export function judgeMessages(unit) {
  const messages = [];
  JUDGE_SHOTS.forEach(([clause, answer], i) => {
    messages.push({ role: "user", content: (i === 0 ? JUDGE_HEAD + "\n\n" : "") + `CLAUSE: ${clause}` });
    messages.push({ role: "assistant", content: answer });
  });
  const ctx = unit.context ? `(Sentence before it, for context only: ${unit.context})\n` : "";
  messages.push({ role: "user", content: `${ctx}CLAUSE: ${unit.text}` });
  return messages;
}

export function parseJudge(raw) {
  const line = (raw || "").trim().split("\n")[0].replace(/\*/g, "").trim();
  const m = line.match(/^([A-Z_]+)\s*(?:\|\s*(.*))?$/);
  let label = m ? m[1] : (line.match(/\b(ARRIVAL|TRACKING|ACCESSORIAL|PAPERWORK|PAYMENT|DEDUCTION|LIABILITY|NONE)\b/) || [])[1];
  if (!label || (label !== "NONE" && !LABELS.includes(label))) label = "NONE";
  const meaning = m && m[2] ? m[2].trim() : "";
  return { label, meaning };
}

const FACTS_PROMPT = `Below is the top of a freight broker's rate confirmation.
Copy these fields exactly as they appear in the text. Use null if a field is not there.
Reply with JSON only, using these keys:
{"broker": "the freight broker company name", "load_number": "the broker's load, order, pro, or confirmation number", "total_pay": "the total dollar amount paid to the carrier", "pickup_city": "city and state of the pickup", "pickup_date": "pickup date", "delivery_city": "city and state of the delivery", "delivery_date": "delivery date", "miles": "loaded miles"}

TEXT:
`;

export function factsMessages(docText) {
  return [{ role: "user", content: FACTS_PROMPT + docText.slice(0, 1800) }];
}

export function parseFacts(raw, docText) {
  const keys = ["broker", "load_number", "total_pay", "pickup_city", "pickup_date", "delivery_city", "delivery_date", "miles"];
  const m = (raw || "").match(/\{[\s\S]*\}/);
  let obj = {};
  if (m) {
    try { obj = JSON.parse(m[0]); } catch { obj = {}; }
  }
  // If the JSON was cut off or malformed, fall back to reading "key": "value" pairs.
  for (const k of keys) {
    if (obj[k] !== undefined) continue;
    const mm = (raw || "").match(new RegExp('"' + k + '"\\s*:\\s*("([^"]*)"|null|[0-9.,$]+)'));
    if (mm) obj[k] = mm[2] !== undefined ? mm[2] : (mm[1] === "null" ? null : mm[1]);
  }
  const hay = normalize(docText).toLowerCase();
  const hayDigits = hay.replace(/,/g, "");
  const facts = {};
  for (const k of keys) {
    let v = obj[k];
    if (v === null || v === undefined || v === "" || String(v).toLowerCase() === "null") { facts[k] = { value: null, verified: false }; continue; }
    v = String(v).trim();
    // A value only counts as verified if the document really contains it.
    let verified = hay.includes(v.toLowerCase().replace(/\s+/g, " "));
    if (!verified && (k === "total_pay" || k === "miles")) {
      const n = moneyToNumber(v);
      if (n !== null) verified = hayDigits.includes(String(Math.round(n))) && n >= 10;
    }
    facts[k] = { value: v, verified };
  }
  return facts;
}

export function moneyToNumber(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Keyword baseline. This is what you get with no model at all. It is here so
// the write-up can say honestly what the model adds.
// ---------------------------------------------------------------------------

const KEYWORD_RULES = [
  ["TRACKING", /\b(track\w*|check call\w*|macropoint|visibility|status call\w*|location update\w*|missed update)\b/i],
  ["ACCESSORIAL", /\b(detention|layover|tonu|truck ordered not used|free time|wait time|delay pay)\b/i],
  ["PAPERWORK", /\b(pod|proof of delivery|paperwork|delivery receipt\w*|invoices? (submitted|are not))\b/i],
  ["ARRIVAL", /\b(late|early|appointment\w*|no-?show|on time)\b/i],
  ["PAYMENT", /\b(net \d+|quick ?pay|payment terms|factor\w*|\d+ days)\b/i],
  ["LIABILITY", /\b(liab\w*|claim\w*|damage\w*|shortage\w*)\b/i],
  ["DEDUCTION", /\b(deduct\w*|fee|fees|charge\w*|lumper\w*|all[- ]in|re-?broker\w*|set ?off|offset)\b/i],
];

export function keywordJudge(text) {
  for (const [label, re] of KEYWORD_RULES) {
    if (re.test(text)) return { label, meaning: "" };
  }
  return { label: "NONE", meaning: "" };
}

// ---------------------------------------------------------------------------
// Things computed from the flags without the model
// ---------------------------------------------------------------------------

export function extractAmounts(text) {
  const out = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;
  let m;
  while ((m = re.exec(text))) {
    const value = parseFloat(m[1].replace(/,/g, ""));
    const after = text.slice(m.index, m.index + m[0].length + 40).toLowerCase();
    const perHour = /(per|an|each|every|\/)\s*(hour|hr)/.test(after);
    out.push({ value, perHour });
  }
  const pct = text.match(/(\d+(?:\.\d+)?)\s?%/g) || [];
  pct.forEach((p) => out.push({ percent: parseFloat(p) }));
  return out;
}

export function missingProtections(docText, flags) {
  const acc = flags.filter((f) => f.label === "ACCESSORIAL").map((f) => f.text).join(" ").toLowerCase();
  const all = docText.toLowerCase();
  const has = (re) => re.test(acc) || re.test(all);
  const missing = [];
  if (!has(/detention|wait time|waiting|free time|delay pay|delays? over|per hour (for|after)/)) missing.push({ key: "detention", text: "No detention pay is written into this confirmation." });
  if (!has(/tonu|truck ordered not used|cancel/)) missing.push({ key: "tonu", text: "Nothing says what you are paid if the load cancels after you are dispatched (TONU)." });
  if (!has(/layover|held overnight|per day|24 hour period/)) missing.push({ key: "layover", text: "No layover pay is written in if you are held overnight." });
  return missing;
}

export function exposure(flags) {
  let fixed = 0;
  let hourly = 0;
  for (const f of flags) {
    if (!["ARRIVAL", "TRACKING", "PAPERWORK", "DEDUCTION"].includes(f.label)) continue;
    for (const a of extractAmounts(f.text)) {
      if (a.value === undefined) continue;
      if (a.perHour) hourly += a.value; else fixed += a.value;
    }
  }
  return { fixed, hourly };
}

export function counterNote(facts, missing, prefs) {
  const p = Object.assign({ detention: 50, freeHours: 2, tonu: 250, layover: 250 }, prefs || {});
  const load = facts && facts.load_number && facts.load_number.value ? ` for load ${facts.load_number.value}` : "";
  const lines = [];
  if (missing.find((m) => m.key === "detention")) lines.push(`- Detention: $${p.detention} per hour after ${p.freeHours} free hours at each stop, billed from signed in and out times on the BOL.`);
  if (missing.find((m) => m.key === "tonu")) lines.push(`- TONU: $${p.tonu} if the load cancels after the truck is dispatched.`);
  if (missing.find((m) => m.key === "layover")) lines.push(`- Layover: $${p.layover} per day if the truck is held overnight through no fault of the carrier.`);
  if (!lines.length) return "";
  return `Hello,\n\nBefore I sign the rate confirmation${load}, please add the following and send a revised copy:\n\n${lines.join("\n")}\n\nThank you.`;
}

export function sortFlags(flags) {
  return [...flags].sort((a, b) => (LABEL_INFO[b.label].weight - LABEL_INFO[a.label].weight) || (a.id - b.id));
}

// ---------------------------------------------------------------------------
// PDF text reconstruction. Input is the items array from pdf.js getTextContent().
// Output is plain text with one paragraph per line.
// ---------------------------------------------------------------------------

export function pdfItemsToText(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;
    if (cur && Math.abs(y - cur.y) <= h * 0.5) {
      const gap = x - cur.xEnd;
      cur.text += (gap > h * 0.25 && !cur.text.endsWith(" ") ? " " : "") + it.str;
      cur.xEnd = x + (it.width || 0);
    } else {
      if (cur) lines.push(cur);
      cur = { text: it.str, x, y, h, xEnd: x + (it.width || 0) };
    }
  }
  if (cur) lines.push(cur);
  const paras = [];
  let p = null;
  let prev = null;
  for (const ln of lines) {
    const t = ln.text.trim();
    if (!t) continue;
    const gap = prev ? prev.y - ln.y : 0;
    const sameBlock = prev && gap > 0 && gap <= Math.max(prev.h, ln.h) * 1.75 && Math.abs(ln.x - prev.x) < 40;
    if (p !== null && sameBlock) p += " " + t; else { if (p !== null) paras.push(p); p = t; }
    prev = ln;
  }
  if (p !== null) paras.push(p);
  return paras.join("\n");
}
