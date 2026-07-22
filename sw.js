// v3: switched from cache-first to network-first for HTML/data/scripts.
// Cache-first was serving a stale copy of the whole app indefinitely once
// cached, even after index.html changed on the server — this is why "Sync
// now" and screenshot updates could silently keep showing old content.
// Static icon assets still use cache-first since those rarely change and
// benefit from being instant/offline-available.

const CACHE_NAME = "rank1-watch-v3";
const STATIC_ASSETS = [
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isStaticIcon = STATIC_ASSETS.some((asset) => url.pathname.endsWith(asset.replace("./", "/")));

  if (isStaticIcon) {
    // cache-first: these rarely change, fine to serve instantly from cache
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // network-first for everything else (index.html, manifest.json,
  // data/leaderboard.json, data/build-screenshot.png) — always try to get the
  // freshest version, only fall back to cache if actually offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
