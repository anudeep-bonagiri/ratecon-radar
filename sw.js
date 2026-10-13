// Service worker: keeps the app shell and the library files so RateCon Radar
// opens with no connection. Model weights are cached separately by Transformers.js.
const VERSION = "rr-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "core.js", "worker.js", "pdf.min.mjs", "pdf.worker.min.mjs", "manifest.webmanifest", "icon.svg",
  "sample-cedar-gap.pdf", "sample-sawgrass.pdf", "sample-granite-pass.pdf"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("rr-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !cdn) return; // model files: left to Transformers.js and the network
  if (cdn) {
    // Library files are pinned to a version, so cache first.
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // App files: try the network so updates arrive, fall back to the cache offline.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
