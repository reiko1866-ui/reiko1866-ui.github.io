(function (global) {
  "use strict";

  var MAP_KEY = "nav2_audio_map";
  var LIST_KEY = "nav2_audio_selected";
  var FILES_URL = "./voice/files.json";
  var PACK_URL = "./voice/pack.json";
  var EVENTS = [
    { id: "turn-left", label: "Balra (turn-left)" },
    { id: "turn-right", label: "Jobbra (turn-right)" },
    { id: "turn-left-sharp", label: "Élesen balra" },
    { id: "turn-right-sharp", label: "Élesen jobbra" },
    { id: "keep-left", label: "Tarts balra" },
    { id: "keep-right", label: "Tarts jobbra" },
    { id: "uturn", label: "Visszafordulás" },
    { id: "roundabout", label: "Körforgalom" },
    { id: "motorway-on", label: "Autópályára" },
    { id: "motorway-off", label: "Lehajtó" },
    { id: "recalculating", label: "Újratervezés (recalculating)" },
    { id: "speed-warning", label: "Gyorshajtás (speed-warning)" },
    { id: "arrived", label: "Megérkeztél (arrived)" }
  ];
  var CAT_EVENT = {
    left: "turn-left",
    right: "turn-right",
    leftSharp: "turn-left-sharp",
    rightSharp: "turn-right-sharp",
    leftKeep: "keep-left",
    rightKeep: "keep-right",
    uturn: "uturn",
    roundabout: "roundabout",
    motorwayOn: "motorway-on",
    motorwayOff: "motorway-off",
    arrive: "arrived"
  };

  var files = [];
  var ready = null;
  var audio = null;
  var unlocked = false;
  var uiBound = false;

  function on(el, type, fn, opts) {
    try {
      if (typeof el === "string") el = document.getElementById(el);
      if (!el || typeof el.addEventListener !== "function") return false;
      el.addEventListener(type, fn, opts);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function clipUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/^https?:/i.test(s)) return s;
    s = s.replace(/\.ogg$/i, ".mp3");
    if (s.indexOf("/") === -1) s = "./voice/clips/" + s;
    if (s.indexOf("./") !== 0 && s.indexOf("/") !== 0) s = "./voice/clips/" + s.replace(/^.*\//, "");
    return s;
  }

  function fileLabel(path) {
    var s = clipUrl(path);
    var i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function readMap() {
    try {
      var map = JSON.parse(localStorage.getItem(MAP_KEY) || "{}");
      if (map && typeof map === "object" && !Array.isArray(map)) return map;
    } catch (_e) {}
    return {};
  }

  function writeMap(map) {
    var clean = {};
    var urls = [];
    Object.keys(map || {}).forEach(function (k) {
      var u = clipUrl(map[k]);
      if (!u) return;
      clean[k] = u;
      urls.push(u);
    });
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify(clean));
      localStorage.setItem(LIST_KEY, JSON.stringify(urls));
    } catch (_e) {}
    if (global.NavSw && typeof global.NavSw.cacheSounds === "function") {
      global.NavSw.cacheSounds();
    }
    return clean;
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.setAttribute("playsinline", "");
    audio.setAttribute("preload", "auto");
    audio.style.display = "none";
    document.body.appendChild(audio);
    return audio;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    var el = ensureAudio();
    var p = el.play();
    if (p && p.then) {
      p.then(function () {
        el.pause();
        try { el.currentTime = 0; } catch (_e) {}
      }).catch(function () {});
    }
  }

  function playFile(path) {
    var url = clipUrl(path);
    if (!url) return false;
    var el = ensureAudio();
    try { el.pause(); } catch (_e) {}
    el.src = url;
    try { el.currentTime = 0; } catch (_e2) {}
    var p = el.play();
    if (p && p.catch) p.catch(function () {});
    return true;
  }

  function playEvent(id) {
    var map = readMap();
    var path = map[id];
    if (!path) return false;
    return playFile(path);
  }

  function loadFiles() {
    if (ready) return ready;
    ready = fetch(FILES_URL)
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .catch(function () {
        return fetch(PACK_URL).then(function (res) { return res.ok ? res.json() : []; });
      })
      .then(function (list) {
        var seen = {};
        files = [];
        (Array.isArray(list) ? list : []).forEach(function (item) {
          var u = clipUrl(item);
          if (!u || seen[u]) return;
          seen[u] = true;
          files.push(u);
        });
        files.sort(function (a, b) {
          return fileLabel(a).localeCompare(fileLabel(b), "hu");
        });
        return files;
      })
      .catch(function () {
        files = [];
        return files;
      });
    return ready;
  }

  function fillSelect(sel, current) {
    sel.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "— nincs hang";
    sel.appendChild(empty);
    files.forEach(function (url) {
      var opt = document.createElement("option");
      opt.value = url;
      opt.textContent = fileLabel(url);
      sel.appendChild(opt);
    });
    if (current && !files.some(function (u) { return u === current; })) {
      var extra = document.createElement("option");
      extra.value = current;
      extra.textContent = fileLabel(current);
      sel.appendChild(extra);
    }
    sel.value = current || "";
  }

  function renderPanel() {
    var list = document.getElementById("mapperList");
    if (!list) return;
    list.innerHTML = "";
    var map = readMap();
    EVENTS.forEach(function (ev) {
      var row = document.createElement("div");
      row.className = "mapper-row";
      var lab = document.createElement("label");
      lab.setAttribute("for", "mapSel-" + ev.id);
      lab.textContent = ev.label;
      var sel = document.createElement("select");
      sel.id = "mapSel-" + ev.id;
      sel.setAttribute("data-event", ev.id);
      fillSelect(sel, map[ev.id] || "");
      on(sel, "change", function () {
        var next = readMap();
        if (sel.value) next[ev.id] = sel.value;
        else delete next[ev.id];
        writeMap(next);
      });
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Teszt";
      on(btn, "click", function () {
        unlock();
        if (sel.value) playFile(sel.value);
      });
      row.appendChild(lab);
      row.appendChild(sel);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function openMapper() {
    var modal = document.getElementById("audioMapper");
    var overlay = document.getElementById("mapperOverlay");
    if (!modal) return;
    loadFiles().then(function () {
      renderPanel();
      if (overlay) overlay.classList.add("open");
      modal.classList.add("open");
    });
  }

  function closeMapper() {
    var modal = document.getElementById("audioMapper");
    var overlay = document.getElementById("mapperOverlay");
    if (overlay) overlay.classList.remove("open");
    if (modal) modal.classList.remove("open");
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    var openBtn = document.getElementById("mapperBtn");
    var closeBtn = document.getElementById("mapperClose");
    var overlay = document.getElementById("mapperOverlay");
    on(openBtn, "click", openMapper);
    on(closeBtn, "click", closeMapper);
    on(overlay, "click", closeMapper);
    on(document, "pointerdown", unlock, { once: true });
  }

  function boot() {
    bindUi();
    loadFiles();
  }

  if (document.readyState === "loading") on(document, "DOMContentLoaded", boot);
  else boot();

  global.NavVoice = {
    events: EVENTS,
    files: function () { return files.slice(); },
    init: loadFiles,
    playCat: function () { return false; },
    playFile: playFile,
    playEvent: playEvent,
    playFromCat: function (cat) {
      var id = CAT_EVENT[cat];
      return id ? playEvent(id) : false;
    },
    eventFromCat: function (cat) {
      return CAT_EVENT[cat] || "";
    },
    open: openMapper,
    close: closeMapper,
    map: readMap
  };
})(typeof window !== "undefined" ? window : this);
