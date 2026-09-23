const CACHE = "nav-v112";
const CORE = [
  "./",
  "./index.html",
  "./demo.html",
  "./app.js",
  "./car-layer.js",
  "./sw-register.js",
  "./version.json",
  "./style.css",
  "./vendor/three.min.js",
  "./vendor/GLTFLoader.js",
  "./vendor/maplibre-gl.js",
  "./vendor/maplibre-gl.css",
  "./vendor/pmtiles.js",
  "./map/style.json",
  "./manifest.json",
  "./manifest.webmanifest",
  "./manifest-demo.webmanifest",
  "./icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./voice/audio-manager.js",
  "./voice/files.json",
  "./voice/pack.json",
  "./voice/catalog.json"
];
const MODELS = [
  "./models/verso.glb",
  "./models/scross.glb",
  "./models/bmw3.glb",
  "./models/merc_e.glb",
  "./models/korando.glb",
  "./models/golf.glb"
];
const MAP_FILES = ["./map/europe.pmtiles"];

function isVersionReq(url) {
  return /\/version\.json$/i.test(url.pathname);
}

function isPmtilesReq(url) {
  return /\.pmtiles$/i.test(url.pathname);
}

async function addSafe(cache, urls) {
  for (let i = 0; i < urls.length; i++) {
    try {
      await cache.add(urls[i]);
    } catch (_e) {}
  }
}

async function cacheUrlList(urls) {
  const cache = await caches.open(CACHE);
  const list = (urls || []).map(function (u) {
    return String(u || "").trim();
  }).filter(Boolean);
  await addSafe(cache, list);
}

async function handleRange(req) {
  const cache = await caches.open(CACHE);
  const url = req.url.split("?")[0];
  let cached = await cache.match(url);
  if (!cached) cached = await cache.match(new Request(url));
  if (!cached) {
    try {
      return await fetch(req);
    } catch (_e) {
      return new Response("", { status: 503, statusText: "Offline map missing" });
    }
  }
  const range = req.headers.get("Range");
  if (!range) return cached;
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) return cached;
  const blob = await cached.blob();
  const size = blob.size;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return new Response("", {
      status: 416,
      headers: { "Content-Range": "bytes */" + size }
    });
  }
  const stop = Math.min(end, size - 1);
  const slice = blob.slice(start, stop + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Range": "bytes " + start + "-" + stop + "/" + size,
      "Content-Length": String(stop - start + 1)
    }
  });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try {
        await cache.put(req, res.clone());
      } catch (_e) {}
    }
    return res;
  } catch (_e) {
    if (req.mode === "navigate" || req.destination === "document") {
      return (await cache.match("./index.html", { ignoreSearch: true })) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: "no-store" });
    if (res && res.ok) {
      try {
        await cache.put(req, res.clone());
      } catch (_e) {}
    }
    return res;
  } catch (_e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await addSafe(cache, CORE);
      await addSafe(cache, MODELS);
      await addSafe(cache, MAP_FILES);
      await self.skipWaiting();
    })
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

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(cacheUrlList(data.urls));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isPmtilesReq(url)) {
    event.respondWith(handleRange(req));
    return;
  }
  if (isVersionReq(url)) {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});
