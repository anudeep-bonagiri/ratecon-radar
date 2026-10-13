# RateCon Radar

Read the fine print on a freight rate confirmation before you sign it.

Live demo: https://anudeep-bonagiri.github.io/ratecon-radar/

Drop in a rate confirmation PDF. RateCon Radar pulls out the load details and lists every clause that can cost the carrier money: late and early arrival fines, tracking penalties, detention conditions, paperwork deadlines, quick pay fees, chargebacks. Each flag shows the exact sentence from the document next to a one-line reading in plain English. It also tells you what is not in writing (detention, layover, TONU) and drafts a short message asking the broker to add it.

The model is Google's open-weight Gemma, and it runs inside the browser tab on the user's own GPU. The document is never uploaded.

## Why it runs locally

A rate confirmation shows what a broker is paying on a lane, and carriers sign them under time pressure, often from a truck. An owner-operator should not have to send that document to somebody's server to find out what it says. Running the model in the browser also means there is no inference bill, so the tool can be sold for a few dollars a month or given away, and it keeps working without a connection once the model is cached.

The privacy claim is enforced by the browser. `index.html` sets a Content Security Policy that only allows connections to this site, the jsDelivr CDN (library code) and Hugging Face (model weights). The model worker is started from a blob URL so it inherits the same policy. The "Run the privacy test" button tries to reach an outside server from both the page and the worker and reports whether the browser refused.

## How it works

1. pdf.js extracts the text in the browser.
2. The text is split into sentences. A keyword and dollar-sign filter drops sentences that cannot be money terms (addresses, greetings, equipment notes).
3. Gemma reads each remaining sentence and answers with one of eight labels and a plain-English line of under 20 words. A second prompt extracts the broker, load number, pay, lane, dates and miles as JSON.
4. Every extracted fact is checked against the document text. A value the document does not contain is marked with a question mark.
5. Totals, missing protections and the counter-terms message are computed in ordinary code from the flags.

Stack: Transformers.js 4.3.1 on WebGPU, pdf.js, plain JavaScript modules, a service worker for offline use. There is no build step and no backend.

## Test results

The test set is eight made-up rate confirmations (`eval-docs.mjs`, rendered to PDF by `make-pdfs.mjs`) with 89 labeled money clauses. Two documents were used while writing the prompt. The numbers below are for the other six, which hold 65 labeled clauses and were scored once after the prompt was frozen. Everything ran in Chrome 154 on an Apple Silicon Mac through `bench.html`, which uses the same worker as the app.

| System | Clauses found | False alarms | Precision | Recall | Right category | Load facts | Time per document |
|---|---|---|---|---|---|---|---|
| Gemma 4 E2B, q4f16 (3.1 GB) | 64 of 65 | 8 | 89% | 99% | 80% | 48 of 48 | 26 s |
| Gemma 3 1B, q4f16 (760 MB) | 23 of 65 | 6 | 79% | 35% | 48% | 31 of 48 | 15 s |
| Gemma 3 270M, q4f16 (270 MB) | 0 of 65 | 0 | n/a | 0% | n/a | 0 of 48 | 7 s |
| Keyword rules, no model | 46 of 65 | 13 | 78% | 71% | 72% | n/a | instant |

Raw outputs are in `bench-results.json`. `node bench-score.mjs test` reproduces the table.

Three things in these numbers deserve a warning.

The one clause Gemma 4 missed ("Payment terms: net 30.") never reached the model. The pre-filter skips sentences shorter than five words. That is a bug in the filter and it is still in the benchmarked version.

All eight false alarms were instructions with no dollar figure attached, such as "Please do not arrive early at the shipper."

The plain-English lines are less reliable than the flags. All 77 lines Gemma 4 wrote for the test documents were read against their quotes (`meaning-grades.mjs`). 64 were accurate and 13 were wrong. Nine of the 13 mixed up who pays whom, for example reading "Cedar Gap pays for excessive loading or unloading delay at $45 per hour" as "You pay $45 per hour for delays." The app now shows a warning on a card when the quote reads as money paid to the carrier and the model's line says the carrier pays. That check catches 8 of the 13, but it was written after seeing these errors, so it has not been tested on anything new.

Other limits: the test documents were written by the same person who wrote the prompt, so treat the table as a sanity check and not a benchmark. No real broker paperwork has been tested yet. Scanned PDFs are not supported. The app needs WebGPU, and the recommended model is a 3.1 GB download the first time.

## Run it yourself

```
git clone https://github.com/anudeep-bonagiri/ratecon-radar
cd ratecon-radar
python3 -m http.server 8765
```

Open http://localhost:8765 in Chrome or Edge. For the benchmark, open `bench.html`, pick a model and press Run.

The Node scripts (`eval-run.mjs`, `eval-score.mjs`) run the same prompts on CPU with onnxruntime. They need `npm install` first and are slow: about 30 seconds per sentence for Gemma 4 E2B on two cores.

## Files

`core.js` holds the sentence splitter, the filter, both prompts, the parsers, the fact checker and the keyword baseline. `worker.js` loads the model and runs the prompts. `app.js` and `index.html` are the page. `score.js` is the scoring code shared by the browser benchmark and the Node scripts. `sw.js` caches the app for offline use.

## Licenses and credits

Code in this repository is MIT licensed. pdf.js is Apache 2.0 (`pdfjs-LICENSE.txt`). Gemma 4 weights are Apache 2.0. Gemma 3 weights are under Google's Gemma Terms of Use. The ONNX conversions come from the `onnx-community` organization on Hugging Face.

The idea came from owner-operator threads on TruckersReport about fines for arriving early and about what to negotiate on a rate con, and from FreightWaves' guides to reading one.

This project was built for the Hacktoberfest 2026 Open-Source AI Challenge on DEV. An AI coding agent (Claude) wrote most of the code and ran the tests under the author's direction.

RateCon Radar is a reading aid and not legal advice.
