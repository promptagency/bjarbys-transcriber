// Service worker: makes the app installable and lets it open without a network.
// It only handles the app's own files. Models (Hugging Face), the ONNX runtime
// (jsDelivr) and podcasts are cross-origin and pass straight through; the
// models are cached by Transformers.js itself.
//
// Content-hashed files under assets/ never change, so they are served from
// the cache. Everything else — the page itself above all — is fetched from the
// network first, so a new release shows up on the next visit, and the cached
// copy is only used offline.
const CACHE = "vem-sa-vad-app-v1";

// Cache the app on install, so it opens offline after a single visit: the page,
// the files it links to, and the files those reference in turn (the
// transcription worker and lazily loaded chunks are only named inside the
// JavaScript). Best effort — a failure here just means fewer files offline.
async function precache() {
  const cache = await caches.open(CACHE);
  const seen = new Set();
  const queue = ["./"];
  while (queue.length && seen.size < 60) {
    const path = queue.shift();
    const url = new URL(path, self.registration.scope).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) continue;
      const type = response.headers.get("Content-Type") ?? "";
      if (/html|javascript|css/.test(type)) {
        const text = await response.clone().text();
        // Build output names end in an 8-character content hash ("worker-LB6Nh_sN.js");
        // inside assets/ they are referenced without the folder. The runtime's
        // .wasm is skipped: it is loaded from jsDelivr and cached by Transformers.js.
        for (const match of text.matchAll(/([\w.-]+-[\w-]{8}\.(?:js|css))\b/g)) queue.push(`./assets/${match[1]}`);
      }
      await cache.put(url, response);
    } catch {
      /* offline or a missing file: skip it */
    }
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("vem-sa-vad-app-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function fetchAndKeep(cache, request) {
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/proxy.php")) return;

  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match(request)) ?? fetchAndKeep(cache, request)),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        return await fetchAndKeep(cache, request);
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return (await cache.match("./")) ?? Response.error();
        return Response.error();
      }
    }),
  );
});
