// Shared helpers for the Node evaluation scripts.
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfItemsToText, toUnits } from "./core.js";
import { attachGold } from "./score.js";
import { DOCS } from "./eval-docs.mjs";

export async function pdfToText(path) {
  const data = new Uint8Array(fs.readFileSync(path));
  const pdf = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(pdfItemsToText(tc.items));
  }
  return pages.join("\n");
}

export async function loadDoc(doc) {
  const text = await pdfToText(`sample-${doc.id}.pdf`);
  const units = attachGold(toUnits(text), doc);
  return { text, units };
}
export { DOCS };
