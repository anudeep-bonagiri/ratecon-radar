---
title: "RateCon Radar: Gemma reads a trucker's contract in a browser tab, and the contract never leaves the laptop"
published: false
tags: devchallenge, hf26challenge, opensource, ai
cover_image: https://anudeep-bonagiri.github.io/ratecon-radar/docs/images/cover.png
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12)*

*I built this with an AI coding agent. The section called My Agent Session says exactly what the agent did.*

## What I Built

On April 22, 2013, a driver started a thread on TruckersReport called "[Fined for delivery early](https://www.thetruckersreport.com/truckingindustryforum/threads/fined-for-delivery-early.211242/)." It ran six pages. Near the end a poster named Big Jay gave the advice the thread had been circling: follow the rate confirmation exactly, whether or not you agree with it. Another reply pointed out that the carrier is the one who gets fined, since the charge is either passed down from the shipper or written into the rate con. A second six-page thread from the same year is about a broker deducting from the rate over an early arrival.

A rate confirmation is the one-load contract a freight broker sends a carrier. The top of it has the pickup, the delivery and the pay. The rest is terms, and the terms are where the money goes. FreightWaves' [guide to the fine print](https://www.freightwaves.com/news/every-load-you-haul-starts-here-dont-skip-the-fine-print) lists $150 per hour for a late arrival, $250 for a tracking lapse and up to $300 for a dirty trailer, and says small carriers often lose $250 to $500 to deductions like these. Owner-operators sign these documents from the seat of a truck, usually with the load about to go to someone else.

RateCon Radar reads the document before the driver signs it. You drop in the PDF. It pulls out the broker, load number, pay, lane, dates and miles, then lists every clause that can cost you money. Each flag shows the sentence copied from the document, and above it one line in plain English.

![RateCon Radar after reading a sample rate confirmation](https://anudeep-bonagiri.github.io/ratecon-radar/docs/images/shot-results.png)

It also tells you what is missing. In a 2018 thread called "[Signed Rate Con](https://www.thetruckersreport.com/truckingindustryforum/goto/post?id=7971156)," the original poster argued that detention and TONU (the fee for a truck that is ordered and then cancelled) are the terms worth negotiating load by load. Another poster replied that in about 800 loads that year they had seen exactly one sheet with a carrier's accessorial terms spelled out. So when a confirmation says nothing about detention, layover or TONU, the app drafts the message that asks for them, with rates you can edit.

The whole thing runs in a browser tab. The model is Google's open-weight Gemma 4, running on the driver's own GPU through WebGPU. The PDF is never uploaded, because there is no server to upload it to.

Who would pay for it? An owner-operator who books their own freight, or a small dispatch service that reads dozens of rate cons a day. The pitch is arithmetic. One avoided $150 late fee covers years of a tool that costs a few dollars a month. Nobody has paid yet. More on that under What is next.

## Demo

Live: **https://anudeep-bonagiri.github.io/ratecon-radar/**

Code, test documents and raw results: **https://github.com/anudeep-bonagiri/ratecon-radar**

To try it, open the link in Chrome or Edge on a laptop or desktop and press one of the sample buttons. The first run downloads the model, which is 3.1 GB, and after that it loads from the browser's own storage in about four seconds. A one-page rate con takes 20 to 31 seconds on an Apple Silicon Mac. If you have a real rate confirmation, drop it in. It will not go anywhere.

There is a button at the bottom of the page called "Run the privacy test." It tries to send a request to an outside server from the page and from the model's worker, and it only passes if the browser reports that it blocked both.

## Code

{% github anudeep-bonagiri/ratecon-radar %}

Everything is in the repository: the app, both prompts (`src/core.js`), the eight test documents with their labels (`eval/docs.mjs`), the raw model outputs from the benchmark (`eval/results/bench-results.json`) and the grading of the plain-English lines (`eval/meaning-grades.mjs`). `npm run score` reproduces the results table below. The code is MIT licensed.

## How I Built It

pdf.js extracts the text in the browser. The text is split into sentences, and a filter drops the ones that cannot be money terms. Gemma reads each remaining sentence alongside 13 worked examples and answers with a label and a line of under 20 words. A second prompt extracts the load facts as JSON, and every value is then checked against the document. If the document does not contain it, the app marks it with a question mark. The 1B model got 17 of 48 facts wrong or missing, and that check kept every one of them from being shown as confirmed. Totals, missing protections and the counter-terms message are ordinary code.

The stack is Transformers.js 4.3.1 on WebGPU, pdf.js and plain JavaScript modules. There is no build step and no backend. It is hosted on GitHub Pages.

Two details are worth passing on. Chrome checks a module worker's imports against `worker-src` and not `script-src`, so the model library was blocked until the policy allowed the CDN there too. And the 4-bit weights do not load on the WebAssembly backend ("Could not find an implementation for GatherBlockQuantized"), so there is no CPU fallback and the app requires WebGPU.

### What the tests showed

The test set is eight made-up rate confirmations rendered to PDF, with 89 labeled money clauses. Two documents were used while writing the prompt. The table below is for the other six, which hold 65 clauses and were scored once after the prompt was frozen. Everything ran in Chrome 154 on an Apple Silicon Mac, through a benchmark page that uses the same worker as the app.

| System | Money clauses found | False alarms | Load facts right | Time per document |
|---|---|---|---|---|
| Gemma 4 E2B (3.1 GB) | 64 of 65 | 8 | 48 of 48 | 26 s |
| Gemma 3 1B (760 MB) | 23 of 65 | 6 | 31 of 48 | 15 s |
| Gemma 3 270M (270 MB) | 0 of 65 | 0 | 0 of 48 | 7 s |
| Keyword rules, no model | 46 of 65 | 13 | not applicable | instant |

The keyword baseline did well, and it is worth saying so. Seven regular expressions found 46 of 65 clauses. What they missed was paraphrase. "Carrier shall forfeit $100 of the agreed rate for every hour, or part of an hour, that the vehicle is not at the destination by the required delivery time" contains no "late," no "fee" and no "fine." Gemma flagged it and wrote: "You forfeit $100 for every hour the truck is late." The rules also flagged "Late model, clean and dry equipment is required" as a late-arrival clause. Gemma did not.

The one clause Gemma 4 missed never reached it. "Payment terms: net 30." is four words long, and the pre-filter skipped sentences under five words. After this run I lowered that limit to four and ran the six documents again. Gemma 4 then found 65 of 65. The change also let two total-pay lines through, which it flagged, so false alarms went from 8 to 10. And its reading of the newly found clause was "You have 30 days to pay," which has the direction backwards, the same mistake described next. The table shows the first run, because that is the one scored before anything was changed.

The plain-English lines are the weak part. All 77 lines Gemma 4 wrote for the test documents were read against their quotes. 64 were accurate and 13 were wrong. Nine of the 13 mixed up who pays whom. The quote said "Cedar Gap pays for excessive loading or unloading delay at $45 per hour," and the model wrote "You pay $45 per hour for delays." For a tool whose job is to tell a driver what a clause costs, that is the worst mistake it could make.

So the app never shows the model's line without the quote under it, and it now runs a check: if the quote reads as money paid to the carrier and the model's line says the carrier pays, the card gets a warning.

![A flag card with a who-pays-whom warning](https://anudeep-bonagiri.github.io/ratecon-radar/docs/images/shot-warning.png)

That check catches 8 of the 13 bad lines. It was written after seeing those errors, so it has not been tested on anything new.

Two more limits. The test documents and the prompt came out of the same working session, so the table is a sanity check and not a benchmark. And no real broker paperwork has gone through it yet.

## Why Does Open Innovation Matter?

The document is the reason. A rate con shows what a broker pays on a lane and who the customer is. With a hosted model, every one of those documents would go to a third party before the driver had even decided to take the load. Here the page sets a Content Security Policy that allows connections to three places: the site itself, the jsDelivr CDN for library code, and Hugging Face for the model weights. The model worker is started from a blob URL so that it inherits the same policy. The browser enforces the claim, and the test button lets anyone check it.

Cost is the second reason, and it is what makes this a side hustle. The app judges each sentence separately with the full instructions attached, so one single-page test document came to about 18 model calls and 15,000 input tokens. Real ones are longer: FreightWaves says a broker's general terms can run two to four pages. On a hosted API that is a bill that grows with every document a customer checks. With open weights the customer's GPU does the work, and serving one more trucker costs me nothing. That leaves room to charge five dollars a month, or to give it away.

Third, open weights mean the model can be chosen by measuring it. Three Gemma sizes went through the same page on the same documents, and the table above is the result. The smallest model answered NONE or nothing at all to every sentence, and when asked for the load facts it mostly copied the field descriptions back. The 1B model found a third of the clauses. Gemma 4 E2B is the first size that does the job, so that is the default, and the picker in the app tells users what the smaller ones cost them. Gemma 4 is also Apache 2.0, which matters if this ever becomes something people pay for.

Fourth, it keeps working without a connection. A service worker caches the app and Transformers.js caches the weights. This was tested in headless Chromium with the network switched off, using the smallest model: the page reopened and the model loaded from cache in three seconds. It has not been tested on a phone or on truck-stop Wi-Fi.

A large hosted model would probably write better plain-English lines than a model this size. That was not measured here, and this is a document I would not send out anyway.

## My Agent Session

I do not have a DevRelay export of the session, so here is the plain account. I directed an AI coding agent, Claude, through this project. It read the forum threads, wrote the code and the test documents, ran the benchmark in Chrome on my Mac, graded the 77 lines and drafted this post. The repository has every prompt, the test documents, the raw model outputs and the grades, so the numbers can be checked.

## What is next

Nobody has used it on a real load yet, so there is no first-user section in this post. The next step is to run real rate confirmations through it with a working owner-operator watching, and to ask the question this week's theme asks: would you pay for this? After that: add OCR for scanned PDFs, and try fine-tuning the 270M model on labeled clauses, since a 270 MB download would suit a phone far better than a 3.1 GB one.

## Prize Categories

Best Use of Gemma. The app runs Gemma 4 E2B locally in the browser, and the benchmark compares it with Gemma 3 1B and Gemma 3 270M on the same task.

RateCon Radar is a reading aid and not legal advice.

## Sources

- TruckersReport, "[Fined for delivery early](https://www.thetruckersreport.com/truckingindustryforum/threads/fined-for-delivery-early.211242/)" (2013)
- TruckersReport, "[CH Robinson deducted my rate for arriving early](https://www.thetruckersreport.com/truckingindustryforum/threads/ch-robinson-deducted-my-rate-for-arriving-early.232542/)" (2013)
- TruckersReport, "[Signed Rate Con](https://www.thetruckersreport.com/truckingindustryforum/goto/post?id=7971156)" (2018)
- Adam Wingfield, "[Every Load You Haul Starts Here: Don't Skip the Fine Print](https://www.freightwaves.com/news/every-load-you-haul-starts-here-dont-skip-the-fine-print)," FreightWaves (2025)
- Adam Wingfield, "[How to Read Your Rate Con Like a Pro](https://www.freightwaves.com/news/how-to-read-your-rate-con-like-a-pro)," FreightWaves (2025)
