/* ===== Life OS — service worker (offline app shell) ===== */
const CACHE = "lifeos-v1";
const ASSETS = [
  "/", "/index.html", "/styles.css",
  "/store.js", "/charts.js", "/data.js", "/app.js",
  "/manifest.webmanifest", "/icon.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Never cache the API — always hit the network so data stays fresh.
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;

  // Cache-first for the app shell, with network fallback that refreshes cache.
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match("/index.html"))
    )
  );
});
