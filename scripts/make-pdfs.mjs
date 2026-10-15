// Renders the synthetic rate confirmations in eval/docs.mjs to samples/*.pdf, so the
// evaluation runs on text pulled back out of a real PDF, the same path the app uses.
import { chromium } from "playwright";
import { DOCS } from "../eval/docs.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const at = (p) => fileURLToPath(new URL(p, new URL("../", import.meta.url))); // path from the repo root

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function html(doc) {
  const head = doc.header.map((h, i) => (i === 0 ? `<h1>${esc(h)}</h1>` : `<p class="hd">${esc(h)}</p>`)).join("");
  const stops = doc.layout === "table"
    ? `<table>${doc.stops.map((s) => `<tr><td>${esc(s)}</td></tr>`).join("")}</table>`
    : doc.stops.map((s) => `<p class="stop">${esc(s)}</p>`).join("");
  const rate = `<div class="rate">${doc.rate.map((r) => `<p>${esc(r)}</p>`).join("")}</div>`;
  let terms;
  if (doc.layout === "numbered") terms = `<ol>${doc.terms.map((t) => `<li>${esc(t.t)}</li>`).join("")}</ol>`;
  else terms = `<div class="${doc.layout === "twocol" ? "two" : ""}">${doc.terms.map((t) => `<p class="term">${esc(t.t)}</p>`).join("")}</div>`;
  const font = { table: "Helvetica, Arial, sans-serif", numbered: "Georgia, 'Times New Roman', serif", twocol: "Arial, sans-serif" }[doc.layout];
  const size = doc.layout === "twocol" ? "8.5pt" : "10pt";
  return `<!doctype html><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.6in; }
  body { font-family: ${font}; font-size: ${size}; line-height: 1.3; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 10pt; }
  p { margin: 0 0 8pt; }
  .hd { margin-bottom: 7pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
  td { border: 1px solid #777; padding: 7pt; }
  .stop { border-left: 3px solid #333; padding-left: 8pt; margin-bottom: 9pt; }
  .rate { margin: 12pt 0; padding: 8pt; background: #eee; font-weight: bold; }
  .rate p { margin-bottom: 7pt; }
  h2 { font-size: 11pt; margin: 14pt 0 8pt; }
  .two { column-count: 2; column-gap: 22pt; }
  .term, li { margin-bottom: 8pt; break-inside: avoid; }
  ol { padding-left: 18pt; }
  .sig { margin-top: 26pt; }
  </style>${head}${stops}${rate}<h2>TERMS AND CONDITIONS</h2>${terms}
  <p class="sig">Carrier signature: ______________________ Date: ____________</p>
  <p class="hd">Sample document for software testing. All parties and details are fictional.</p>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
for (const doc of DOCS) {
  await page.setContent(html(doc));
  const out = at(`samples/${doc.id}.pdf`);
  await page.pdf({ path: out, format: "Letter", printBackground: true });
  console.log("wrote", out, fs.statSync(out).size);
}
await browser.close();
