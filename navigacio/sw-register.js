(function (global) {
  var pending = false;
  var reloading = false;
  var AUDIO_MAP_KEY = "nav2_audio_map";
  var AUDIO_LIST_KEY = "nav2_audio_selected";

  function on(el, type, fn, opts) {
    try {
      if (!el || typeof el.addEventListener !== "function") return false;
      el.addEventListener(type, fn, opts);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function navigating() {
    var app = document.getElementById("app");
    return !!(app && app.classList.contains("is-nav"));
  }

  function apply() {
    if (reloading) return;
    if (navigating()) {
      pending = true;
      return;
    }
    reloading = true;
    location.reload();
  }

  function selectedSoundUrls() {
    var out = [];
    var seen = {};
    function push(raw) {
      var s = String(raw || "").trim();
      if (!s) return;
      if (!/^https?:/i.test(s) && s.indexOf("/") === -1) s = "./voice/clips/" + s;
      if (seen[s]) return;
      seen[s] = true;
      out.push(s);
    }
    try {
      var map = JSON.parse(localStorage.getItem(AUDIO_MAP_KEY) || "{}");
      if (map && typeof map === "object") {
        Object.keys(map).forEach(function (k) { push(map[k]); });
      }
    } catch (_e) {}
    try {
      var list = JSON.parse(localStorage.getItem(AUDIO_LIST_KEY) || "[]");
      if (Array.isArray(list)) list.forEach(push);
    } catch (_e2) {}
    return out;
  }

  function cacheSelectedSounds(reg) {
    var urls = selectedSoundUrls();
    if (!urls.length) return;
    var send = function (sw) {
      if (!sw) return;
      try { sw.postMessage({ type: "CACHE_URLS", urls: urls }); } catch (_e) {}
    };
    if (reg && reg.active) send(reg.active);
    else if (navigator.serviceWorker.controller) send(navigator.serviceWorker.controller);
  }

  function checkBuild() {
    fetch("./version.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (v) {
        if (!v || !v.build) return;
        var last = "";
        try { last = localStorage.getItem("nav_build") || ""; } catch (_e) {}
        try { localStorage.setItem("nav_build", v.build); } catch (_e2) {}
        if (last && last !== v.build) apply();
      })
      .catch(function () {});
  }

  function watch(reg) {
    function poke() {
      try { reg.update(); } catch (_u) {}
      checkBuild();
      cacheSelectedSounds(reg);
    }
    poke();
    on(document, "visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      poke();
      if (pending) apply();
    });
    setInterval(poke, 5 * 60 * 1000);
    if (reg.waiting && navigator.serviceWorker.controller) apply();
  }

  function boot() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    on(navigator.serviceWorker, "controllerchange", apply);
    on(navigator.serviceWorker, "message", function (ev) {
      if (ev.data && ev.data.type === "NAV_SW_UPDATED") apply();
    });
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then(watch)
      .catch(function () {});
  }

  global.NavSw = {
    applyPending: function () {
      if (pending) apply();
    },
    cacheSounds: function () {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        cacheSelectedSounds({ active: navigator.serviceWorker.controller });
      }
    }
  };
  boot();
})(window);
