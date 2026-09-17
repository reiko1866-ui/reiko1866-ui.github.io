const CACHE = "nav-v102";
const CORE = [
  "./",
  "./index.html",
  "./demo.html",
  "./app.js",
  "./car-layer.js",
  "./sw-register.js",
  "./version.json",
  "./vendor/three.min.js",
  "./vendor/GLTFLoader.js",
  "./style.css",
  "./voice/audio-manager.js",
  "./voice/pack.json",
  "./voice/catalog.json",
  "./map/style.json",
  "./manifest.webmanifest",
  "./manifest-demo.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => {
        clients.forEach(function (client) {
          try { client.postMessage({ type: "NAV_SW_UPDATED" }); } catch (_e) {}
        });
      })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\.(mp3|ogg|wav|m4a|pmtiles)$/i.test(url.pathname) || /hungary_jf/i.test(url.pathname) || /voice\/clips/i.test(url.pathname) || /\/map\//i.test(url.pathname)) {
    return;
  }
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
